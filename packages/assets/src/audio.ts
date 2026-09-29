// MIA audio: the song compiler and the sound-effect register writes, held to
// clementina-mia's audio.c sample for sample by Clementina Studio's firmware
// cross-check. Studio plays them in its editors through the package's
// "./audio" export. This module and its Studio validator re-export have no
// platform-specific runtime dependencies. Structural parameter types let both
// Studio records and portable assets use the same compiler.
import type {InstrumentAsset, SongAsset, SongNote, SongVoice, SoundAsset, SoundFrame} from './types.js';

export const AUDIO_SAMPLE_RATE = 24000;
export const AUDIO_VOICE_COUNT = 4;
/** Sequencer opcodes (clementina-mia docs/audio-sequencer.md). */
export const SEQ_OP = {END: 0, NOTE: 1, REST: 2, SET_WAVE: 3, SET_ADSR: 4, SET_PAN: 5, SET_VOL: 6, SET_PULSE: 7, JUMP: 8} as const;
/** Offsets in one 16-byte voice record. */
export const VOICE_REG = {FREQ_L: 0, FREQ_H: 1, PULSE_WIDTH: 2, ATTACK_DECAY: 3, SUSTAIN_RELEASE: 4, WAVEFORM: 5, PAN: 6, CONTROL: 7, VOLUME: 8} as const;
export const VOICE_CONTROL_GATE = 1, VOICE_CONTROL_RESET_PHASE = 2;
const MAX_FREQ = 0xFFFF, MAX_EVENT_SAMPLES = 0x1000000;

export type InstrumentData = Pick<InstrumentAsset, 'id' | 'wave' | 'pulse' | 'attack' | 'decay' | 'sustain' | 'release' | 'volume'>;
export type SongData = Pick<SongAsset, 'bpm' | 'length' | 'loopStart' | 'voices'> & {stepsPerBeat: number};
export type SoundData = Pick<SoundAsset, 'attack' | 'decay' | 'sustain' | 'release' | 'pan' | 'frames'>;

/** The frequency register value (Hz x 16) of a semitone, equal temperament with A4 = 440 Hz. */
export function noteFrequency(note: number): number {
  return Math.min(MAX_FREQ, Math.max(0, Math.round(440 * 2 ** ((note - 57) / 12) * 16)));
}

/** The sample a step starts on. Rounding each boundary, not each duration, keeps every voice on the same clock. */
export function stepSample(song: Pick<SongData, 'bpm' | 'stepsPerBeat'>, step: number): number {
  return Math.round(step * AUDIO_SAMPLE_RATE * 60 / (song.bpm * song.stepsPerBeat));
}

export interface CompiledVoice {
  /** The track, as it would be written at the voice's track_base. */
  bytes: Uint8Array;
  /** Offset of the byte the song's closing JUMP returns to, or null when it ends. */
  loop: number | null;
  notes: number;
}
export interface CompiledSong {
  /** One per MIA voice; null where the song leaves the voice free. */
  voices: Array<CompiledVoice | null>;
  samples: number;
  loopSample: number | null;
}

/**
 * A song as four sequencer tracks. Per voice, in time order: a SET_PAN, then
 * for each note the SET_* opcodes its instrument changes, a one-sample REST
 * when the note must restart the envelope, and the NOTE; RESTs fill the
 * gaps; a JUMP back to the loop start, or END.
 *
 * The one-sample REST exists because the sequencer's NOTE sets the gate, and
 * an envelope only restarts on the gate's rising edge (audio_apply_register):
 * two NOTEs in a row slide from one pitch to the next under one envelope.
 * That slide is what a legato note asks for, so it skips the REST.
 */
export function compileSong(song: SongData, instruments: readonly InstrumentData[]): CompiledSong {
  const byId = new Map(instruments.map(instrument => [instrument.id, instrument]));
  /** Resolve a step to its shared rounded sample boundary. */
  const at = (step: number): number => stepSample(song, step);
  const end = at(song.length);
  const loop = song.loopStart;
  const voices = song.voices.map(voice => voice.notes.length ? compileVoice(voice, byId, at, song.length, loop) : null);
  return {voices, samples: end, loopSample: loop === undefined ? null : at(loop)};
}

type Segment = {from: number; to: number; note?: SongNote; continued?: boolean};

/** Fill note gaps with rests and split a note or rest at the loop boundary. */
function voiceSegments(voice: SongVoice, length: number, loop: number | undefined): {segments: Segment[]; loopSegment: number} {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const note of voice.notes) {
    if (note.step > cursor) segments.push({from: cursor, to: note.step});
    segments.push({from: note.step, to: note.step + note.length, note});
    cursor = note.step + note.length;
  }
  if (cursor < length) segments.push({from: cursor, to: length});
  let loopSegment = 0;
  if (loop !== undefined) {
    const crossing = segments.findIndex(segment => segment.from < loop && segment.to > loop);
    if (crossing >= 0) segments.splice(crossing, 1, {...segments[crossing], to: loop}, {...segments[crossing], from: loop, continued: true});
    loopSegment = segments.findIndex(segment => segment.from >= loop);
  }
  return {segments, loopSegment};
}

/** Append a signed or unsigned 24-bit value in little-endian order. */
function append24(output: number[], value: number): void {
  output.push(value & 255, (value >> 8) & 255, (value >> 16) & 255);
}

/** Append timed NOTE or REST records, splitting durations above the 24-bit field. */
function appendTimedEvent(output: number[], opcode: typeof SEQ_OP.NOTE | typeof SEQ_OP.REST, samples: number, frequency = 0): void {
  for (; samples > 0; samples -= MAX_EVENT_SAMPLES) {
    output.push(opcode);
    if (opcode === SEQ_OP.NOTE) output.push(frequency & 255, frequency >> 8);
    // Playback consumes the decoding sample plus the encoded duration.
    append24(output, Math.min(samples, MAX_EVENT_SAMPLES) - 1);
  }
}

/** Compile one voice to a relocatable sequencer opcode stream. */
function compileVoice(voice: SongVoice, byId: Map<string, InstrumentData>, at: (step: number) => number, length: number, loop: number | undefined): CompiledVoice {
  const {segments, loopSegment} = voiceSegments(voice, length, loop);

  const out: number[] = [];
  out.push(SEQ_OP.SET_PAN, voice.pan & 255);
  // What the voice holds, as far as the track knows. Nothing is known at the
  // start - a sound effect may have left the voice gated - nor where playback
  // arrives from two places, the loop start.
  let state: Record<string, number> = {};
  let gate: boolean | undefined;
  let loopOffset: number | null = null;
  let notes = 0;
  segments.forEach((segment, index) => {
    if (loop !== undefined && index === loopSegment) {
      loopOffset = out.length;
      state = {};
      gate = undefined;
    }
    const samples = at(segment.to) - at(segment.from);
    if (!segment.note) {
      appendTimedEvent(out, SEQ_OP.REST, samples);
      gate = false;
      return;
    }
    const note = segment.note;
    const instrument = byId.get(note.instrumentId);
    const retrigger = !segment.continued && !note.legato && gate !== false;
    if (retrigger) appendTimedEvent(out, SEQ_OP.REST, 1);
    if (instrument) for (const [setting, opcode, ...values] of instrumentOps(instrument)) {
      const value = values[0] * 256 + (values[1] ?? 0);
      if (state[setting] === value) continue;
      state[setting] = value;
      out.push(opcode, ...values);
    }
    appendTimedEvent(out, SEQ_OP.NOTE, samples - (retrigger ? 1 : 0), noteFrequency(note.pitch));
    gate = true;
    if (!segment.continued) notes++;
  });
  if (loopOffset !== null) {
    out.push(SEQ_OP.JUMP);
    append24(out, loopOffset - (out.length + 3));
  } else {
    out.push(SEQ_OP.END);
  }
  return {bytes: Uint8Array.from(out), loop: loopOffset, notes};
}

/** The SET_* opcodes that put an instrument on a voice. */
function instrumentOps(instrument: InstrumentData): Array<[string, number, ...number[]]> {
  return [
    ['wave', SEQ_OP.SET_WAVE, instrument.wave],
    ['adsr', SEQ_OP.SET_ADSR, instrument.attack << 4 | instrument.decay, instrument.sustain << 4 | instrument.release],
    ['pulse', SEQ_OP.SET_PULSE, instrument.pulse],
    ['volume', SEQ_OP.SET_VOL, instrument.volume],
  ];
}

/**
 * The register writes a sound makes, per frame, as a program driving a
 * voice it has taken (VTAKE) writes them: the whole record on the first
 * frame, then only what changes. Gating on also resets the phase, as the
 * ROM's NOTE does. The entry after the last frame releases the gate.
 */
export function soundWrites(sound: SoundData): Array<Array<[number, number]>> {
  const output: Array<Array<[number, number]>> = [];
  let previous: SoundFrame | null = null;
  for (const frame of sound.frames) {
    const writes: Array<[number, number]> = [];
    if (!previous || previous.freq !== frame.freq) writes.push([VOICE_REG.FREQ_L, frame.freq & 255], [VOICE_REG.FREQ_H, frame.freq >> 8]);
    if (!previous || previous.pulse !== frame.pulse) writes.push([VOICE_REG.PULSE_WIDTH, frame.pulse]);
    if (!previous) writes.push([VOICE_REG.ATTACK_DECAY, sound.attack << 4 | sound.decay], [VOICE_REG.SUSTAIN_RELEASE, sound.sustain << 4 | sound.release]);
    if (!previous || previous.wave !== frame.wave) writes.push([VOICE_REG.WAVEFORM, frame.wave]);
    if (!previous) writes.push([VOICE_REG.PAN, sound.pan & 255]);
    if (!previous || previous.volume !== frame.volume) writes.push([VOICE_REG.VOLUME, frame.volume]);
    if (!previous || previous.gate !== frame.gate) writes.push([VOICE_REG.CONTROL, frame.gate ? VOICE_CONTROL_GATE | VOICE_CONTROL_RESET_PHASE : 0]);
    output.push(writes);
    previous = frame;
  }
  output.push(previous?.gate ? [[VOICE_REG.CONTROL, 0]] : []);
  return output;
}

export {validateStudioInstruments, validateStudioSongs, validateStudioSounds} from './studio-audio-validation.js';
export type {StudioInstrumentRecord, StudioSongRecord, StudioSoundRecord} from './studio-audio-validation.js';
