// Studio v2 session validation is browser-safe and shares the portable audio contract.
import type {InstrumentAsset, SongAsset, SoundAsset} from './types.js';

export type StudioInstrumentRecord = Omit<InstrumentAsset, 'format' | 'version'>;
export type StudioSoundRecord = Omit<SoundAsset, 'format' | 'version'>;
export type StudioSongRecord = Omit<SongAsset, 'format' | 'version' | 'stepsPerBeat'> & {stepsPerBeat: number};

const MAX_AUDIO_ASSETS = 255;
const MAX_SOUND_FRAMES = 600;
const MAX_SONG_STEPS = 4096;
const NOTE_COUNT = 96;
const MIN_BPM = 20, MAX_BPM = 400;
const PAN_MIN = -64, PAN_MAX = 63;
const MAX_FREQ = 0xFFFF;
const STEPS_PER_BEAT = [1, 2, 3, 4, 6, 8];
const VOICE_COUNT = 4;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** Test an integer field against its inclusive bounds. */
function audioRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

/** Reject missing or duplicate Studio identities and assembly names. */
function named(list: Array<{id: string; name: string}>, what: string): void {
  const ids = new Set<string>(), names = new Set<string>();
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || !item.id.length || ids.has(item.id)) {
      throw Error(`${what} identities must be unique`);
    }
    ids.add(item.id);
    if (typeof item.name !== 'string' || !IDENTIFIER.test(item.name) || names.has(item.name.toUpperCase())) {
      throw Error(`${what} names must be unique assembly identifiers (1–32 characters)`);
    }
    names.add(item.name.toUpperCase());
  }
}

/** Test the four packed envelope nibbles. */
function envelope(value: {attack: number; decay: number; sustain: number; release: number}): boolean {
  return audioRange(value.attack, 0, 15) && audioRange(value.decay, 0, 15)
    && audioRange(value.sustain, 0, 15) && audioRange(value.release, 0, 15);
}

/** Validate Studio instrument records before conversion to portable assets. */
export function validateStudioInstruments(instruments: StudioInstrumentRecord[]): void {
  if (!Array.isArray(instruments) || instruments.length > MAX_AUDIO_ASSETS) {
    throw Error(`At most ${MAX_AUDIO_ASSETS} instruments are supported`);
  }
  named(instruments, 'Instrument');
  for (const instrument of instruments) {
    if (!audioRange(instrument.wave, 0, 4) || !audioRange(instrument.pulse, 0, 255)
      || !envelope(instrument) || !audioRange(instrument.volume, 0, 255)) {
      throw Error(`Invalid instrument "${instrument.name}"`);
    }
  }
}

/** Validate Studio songs, their voice timing, and instrument references. */
export function validateStudioSongs(songs: StudioSongRecord[], instruments: StudioInstrumentRecord[] = []): void {
  if (!Array.isArray(songs) || songs.length > MAX_AUDIO_ASSETS) {
    throw Error(`At most ${MAX_AUDIO_ASSETS} songs are supported`);
  }
  named(songs, 'Song');
  const instrumentIds = new Set(instruments.map(instrument => instrument.id));
  for (const song of songs) {
    if (!audioRange(song.bpm, MIN_BPM, MAX_BPM) || !STEPS_PER_BEAT.includes(song.stepsPerBeat)
      || !audioRange(song.beatsPerBar, 1, 16)) {
      throw Error(`Invalid tempo in "${song.name}"`);
    }
    if (!audioRange(song.length, 1, MAX_SONG_STEPS)) throw Error(`A song is 1 to ${MAX_SONG_STEPS} steps long`);
    if (song.loopStart !== undefined && !audioRange(song.loopStart, 0, song.length - 1)) {
      throw Error(`The loop in "${song.name}" starts outside the song`);
    }
    // An unused voice remains available for sound effects.
    if (!Array.isArray(song.voices) || song.voices.length !== VOICE_COUNT) {
      throw Error(`A song has exactly ${VOICE_COUNT} voices`);
    }
    for (const voice of song.voices) {
      if (!voice || !audioRange(voice.pan, PAN_MIN, PAN_MAX)
        || !Array.isArray(voice.notes) || voice.notes.length > MAX_SONG_STEPS) {
        throw Error(`Invalid voice in "${song.name}"`);
      }
      let end = 0;
      for (const note of voice.notes) {
        if (!note || !audioRange(note.step, 0, song.length - 1)
          || !audioRange(note.length, 1, song.length - note.step)
          || !audioRange(note.pitch, 0, NOTE_COUNT - 1)) {
          throw Error(`Invalid note in "${song.name}"`);
        }
        if (!instrumentIds.has(note.instrumentId)) {
          throw Error(`A note in "${song.name}" names an instrument that is not in the project`);
        }
        if (note.legato !== undefined && typeof note.legato !== 'boolean') {
          throw Error(`Invalid note in "${song.name}"`);
        }
        if (note.step < end) {
          throw Error(`Notes on one voice of "${song.name}" overlap or are out of order`);
        }
        end = note.step + note.length;
      }
    }
  }
}

/** Validate Studio sound effects and every frame's register values. */
export function validateStudioSounds(sounds: StudioSoundRecord[]): void {
  if (!Array.isArray(sounds) || sounds.length > MAX_AUDIO_ASSETS) {
    throw Error(`At most ${MAX_AUDIO_ASSETS} sounds are supported`);
  }
  named(sounds, 'Sound');
  for (const sound of sounds) {
    if (!envelope(sound) || !audioRange(sound.pan, PAN_MIN, PAN_MAX)) {
      throw Error(`Invalid sound "${sound.name}"`);
    }
    if (!Array.isArray(sound.frames) || sound.frames.length < 1 || sound.frames.length > MAX_SOUND_FRAMES) {
      throw Error(`A sound holds 1 to ${MAX_SOUND_FRAMES} frames`);
    }
    for (const frame of sound.frames) {
      if (!frame || !audioRange(frame.freq, 0, MAX_FREQ) || !audioRange(frame.volume, 0, 255)
        || !audioRange(frame.pulse, 0, 255) || !audioRange(frame.wave, 0, 4)
        || typeof frame.gate !== 'boolean') {
        throw Error(`Invalid frame in "${sound.name}"`);
      }
    }
  }
}
