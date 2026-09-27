// MIA audio: the song compiler and the sound-effect register writes, held to
// clementina-mia's audio.c sample for sample by Clementina Studio's firmware
// cross-check. Studio plays them in its editors through the package's
// "./audio" export, so this module must not import anything at run time: the
// Studio renderer loads it as a plain browser module. The functions take plain
// structural types, so Studio's own records and the portable assets both fit.
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
export function noteFrequency(note: number): number { return Math.min(MAX_FREQ, Math.max(0, Math.round(440 * 2 ** ((note - 57) / 12) * 16))); }

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
  const byId = new Map(instruments.map(i => [i.id, i]));
  const at = (step: number) => stepSample(song, step), end = at(song.length);
  const loop = song.loopStart;
  const voices = song.voices.map(voice => voice.notes.length ? compileVoice(voice, byId, at, song.length, loop) : null);
  return {voices, samples: end, loopSample: loop === undefined ? null : at(loop)};
}

type Segment = {from: number; to: number; note?: SongNote; continued?: boolean};
function compileVoice(voice: SongVoice, byId: Map<string, InstrumentData>, at: (step: number) => number, length: number, loop: number | undefined): CompiledVoice {
  // Notes and the rests between them, split where the loop begins.
  const segments: Segment[] = [];
  let cursor = 0;
  for (const note of voice.notes) {
    if (note.step > cursor) segments.push({from: cursor, to: note.step});
    segments.push({from: note.step, to: note.step + note.length, note});
    cursor = note.step + note.length;
  }
  if (cursor < length) segments.push({from: cursor, to: length});
  let body = 0;
  if (loop !== undefined) {
    const i = segments.findIndex(s => s.from < loop && s.to > loop);
    if (i >= 0) segments.splice(i, 1, {...segments[i], to: loop}, {...segments[i], from: loop, continued: true});
    body = segments.findIndex(s => s.from >= loop);
  }

  const out: number[] = [];
  const push24 = (n: number) => out.push(n & 255, (n >> 8) & 255, (n >> 16) & 255);
  // An event that lasts `samples` holds for its duration field plus one.
  const rest = (samples: number) => { for (; samples > 0; samples -= MAX_EVENT_SAMPLES) { out.push(SEQ_OP.REST); push24(Math.min(samples, MAX_EVENT_SAMPLES) - 1); } };
  const tone = (freq: number, samples: number) => { for (; samples > 0; samples -= MAX_EVENT_SAMPLES) { out.push(SEQ_OP.NOTE, freq & 255, freq >> 8); push24(Math.min(samples, MAX_EVENT_SAMPLES) - 1); } };
  out.push(SEQ_OP.SET_PAN, voice.pan & 255);
  // What the voice holds, as far as the track knows. Nothing is known at the
  // start - a sound effect may have left the voice gated - nor where playback
  // arrives from two places, the loop start.
  let state: Record<string, number> = {}, gate: boolean | undefined, loopOffset: number | null = null, notes = 0;
  segments.forEach((segment, i) => {
    if (loop !== undefined && i === body) { loopOffset = out.length; state = {}; gate = undefined; }
    const samples = at(segment.to) - at(segment.from);
    if (!segment.note) { rest(samples); gate = false; return; }
    const note = segment.note, instrument = byId.get(note.instrumentId);
    const retrigger = !segment.continued && !note.legato && gate !== false;
    if (retrigger) rest(1);
    if (instrument) for (const [key, op, ...values] of instrumentOps(instrument)) {
      if (state[key] === values[0] * 256 + (values[1] ?? 0)) continue;
      state[key] = values[0] * 256 + (values[1] ?? 0); out.push(op, ...values);
    }
    tone(noteFrequency(note.pitch), samples - (retrigger ? 1 : 0));
    gate = true; if (!segment.continued) notes++;
  });
  if (loopOffset !== null) { out.push(SEQ_OP.JUMP); push24(loopOffset - (out.length + 3)); } else out.push(SEQ_OP.END);
  return {bytes: Uint8Array.from(out), loop: loopOffset, notes};
}
/** The SET_* opcodes that put an instrument on a voice. */
function instrumentOps(i: InstrumentData): Array<[string, number, ...number[]]> {
  return [['wave', SEQ_OP.SET_WAVE, i.wave], ['adsr', SEQ_OP.SET_ADSR, i.attack << 4 | i.decay, i.sustain << 4 | i.release], ['pulse', SEQ_OP.SET_PULSE, i.pulse], ['volume', SEQ_OP.SET_VOL, i.volume]];
}

/**
 * The register writes a sound makes, per frame, as a program driving a
 * voice it has taken (VTAKE) writes them: the whole record on the first
 * frame, then only what changes. Gating on also resets the phase, as the
 * ROM's NOTE does. The entry after the last frame releases the gate.
 */
export function soundWrites(sound: SoundData): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let last: SoundFrame | null = null;
  for (const f of sound.frames) {
    const w: Array<[number, number]> = [];
    if (!last || last.freq !== f.freq) w.push([VOICE_REG.FREQ_L, f.freq & 255], [VOICE_REG.FREQ_H, f.freq >> 8]);
    if (!last || last.pulse !== f.pulse) w.push([VOICE_REG.PULSE_WIDTH, f.pulse]);
    if (!last) w.push([VOICE_REG.ATTACK_DECAY, sound.attack << 4 | sound.decay], [VOICE_REG.SUSTAIN_RELEASE, sound.sustain << 4 | sound.release]);
    if (!last || last.wave !== f.wave) w.push([VOICE_REG.WAVEFORM, f.wave]);
    if (!last) w.push([VOICE_REG.PAN, sound.pan & 255]);
    if (!last || last.volume !== f.volume) w.push([VOICE_REG.VOLUME, f.volume]);
    if (!last || last.gate !== f.gate) w.push([VOICE_REG.CONTROL, f.gate ? VOICE_CONTROL_GATE | VOICE_CONTROL_RESET_PHASE : 0]);
    out.push(w); last = f;
  }
  out.push(last?.gate ? [[VOICE_REG.CONTROL, 0]] : []);
  return out;
}

// Studio v2 session validation is browser-safe and shares this audio contract.
export type StudioInstrumentRecord = Omit<InstrumentAsset, 'format' | 'version'>;
export type StudioSoundRecord = Omit<SoundAsset, 'format' | 'version'>;
export type StudioSongRecord = Omit<SongAsset, 'format' | 'version' | 'stepsPerBeat'> & {stepsPerBeat:number};
const MAX_AUDIO_ASSETS = 255, MAX_SOUND_FRAMES = 600, MAX_SONG_STEPS = 4096;
const NOTE_COUNT = 96, MIN_BPM = 20, MAX_BPM = 400, PAN_MIN = -64, PAN_MAX = 63;
const STEPS_PER_BEAT = [1, 2, 3, 4, 6, 8];
const VOICE_COUNT = AUDIO_VOICE_COUNT;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
function audioRange(n: unknown, min: number, max: number): boolean { return Number.isInteger(n) && Number(n) >= min && Number(n) <= max; }
function named(list: Array<{ id: string; name: string }>, what: string): void {
 const ids = new Set<string>(), names = new Set<string>();
 for (const item of list) {
  if (!item || typeof item.id !== 'string' || !item.id.length || ids.has(item.id)) throw Error(`${what} identities must be unique`);
  ids.add(item.id);
  if (typeof item.name !== 'string' || !IDENTIFIER.test(item.name) || names.has(item.name.toUpperCase())) throw Error(`${what} names must be unique assembly identifiers (1–32 characters)`);
  names.add(item.name.toUpperCase());
 }
}
function envelope(e: { attack: number; decay: number; sustain: number; release: number }): boolean {
 return audioRange(e.attack, 0, 15) && audioRange(e.decay, 0, 15) && audioRange(e.sustain, 0, 15) && audioRange(e.release, 0, 15);
}

export function validateStudioInstruments(instruments: StudioInstrumentRecord[]): void {
 if (!Array.isArray(instruments) || instruments.length > MAX_AUDIO_ASSETS) throw Error(`At most ${MAX_AUDIO_ASSETS} instruments are supported`);
 named(instruments, 'Instrument');
 for (const i of instruments) {
  if (!audioRange(i.wave, 0, 4) || !audioRange(i.pulse, 0, 255) || !envelope(i) || !audioRange(i.volume, 0, 255)) throw Error(`Invalid instrument "${i.name}"`);
 }
}

export function validateStudioSongs(songs: StudioSongRecord[], instruments: StudioInstrumentRecord[] = []): void {
 if (!Array.isArray(songs) || songs.length > MAX_AUDIO_ASSETS) throw Error(`At most ${MAX_AUDIO_ASSETS} songs are supported`);
 named(songs, 'Song');
 const instrumentIds = new Set(instruments.map(i => i.id));
 for (const song of songs) {
  if (!audioRange(song.bpm, MIN_BPM, MAX_BPM) || !STEPS_PER_BEAT.includes(song.stepsPerBeat) || !audioRange(song.beatsPerBar, 1, 16)) throw Error(`Invalid tempo in "${song.name}"`);
  if (!audioRange(song.length, 1, MAX_SONG_STEPS)) throw Error(`A song is 1 to ${MAX_SONG_STEPS} steps long`);
  if (song.loopStart !== undefined && !audioRange(song.loopStart, 0, song.length - 1)) throw Error(`The loop in "${song.name}" starts outside the song`);
  // MIA has four voices, so a song has four: a voice without notes is left
  // free for sound effects.
  if (!Array.isArray(song.voices) || song.voices.length !== VOICE_COUNT) throw Error(`A song has exactly ${VOICE_COUNT} voices`);
  for (const voice of song.voices) {
   if (!voice || !audioRange(voice.pan, PAN_MIN, PAN_MAX) || !Array.isArray(voice.notes) || voice.notes.length > MAX_SONG_STEPS) throw Error(`Invalid voice in "${song.name}"`);
   let end = 0;
   for (const note of voice.notes) {
    if (!note || !audioRange(note.step, 0, song.length - 1) || !audioRange(note.length, 1, song.length - note.step) || !audioRange(note.pitch, 0, NOTE_COUNT - 1)) throw Error(`Invalid note in "${song.name}"`);
    if (!instrumentIds.has(note.instrumentId)) throw Error(`A note in "${song.name}" names an instrument that is not in the project`);
    if (note.legato !== undefined && typeof note.legato !== 'boolean') throw Error(`Invalid note in "${song.name}"`);
    // A voice plays one note at a time.
    if (note.step < end) throw Error(`Notes on one voice of "${song.name}" overlap or are out of order`);
    end = note.step + note.length;
   }
  }
 }
}

export function validateStudioSounds(sounds: StudioSoundRecord[]): void {
 if (!Array.isArray(sounds) || sounds.length > MAX_AUDIO_ASSETS) throw Error(`At most ${MAX_AUDIO_ASSETS} sounds are supported`);
 named(sounds, 'Sound');
 for (const sound of sounds) {
  if (!envelope(sound) || !audioRange(sound.pan, PAN_MIN, PAN_MAX)) throw Error(`Invalid sound "${sound.name}"`);
  if (!Array.isArray(sound.frames) || sound.frames.length < 1 || sound.frames.length > MAX_SOUND_FRAMES) throw Error(`A sound holds 1 to ${MAX_SOUND_FRAMES} frames`);
  for (const f of sound.frames) {
   if (!f || !audioRange(f.freq, 0, MAX_FREQ) || !audioRange(f.volume, 0, 255) || !audioRange(f.pulse, 0, 255) || !audioRange(f.wave, 0, 4) || typeof f.gate !== 'boolean') throw Error(`Invalid frame in "${sound.name}"`);
  }
 }
}
