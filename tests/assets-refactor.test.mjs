import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAssetSet, compileSong, encodeBackgroundFile, encodeOverlayFile, SEQ_OP, stepSample} from '../packages/assets/dist/index.js';
import {validateStudioSounds} from '../packages/assets/dist/audio.js';

const cell = () => ({tile: 7, paletteBank: 2, flipX: true, flipY: false, priority: false, chrAlt: true});

test('background and overlay encoders keep tile and attribute planes separate', () => {
  const background = encodeBackgroundFile({width: 2, height: 1, cells: [cell(), {...cell(), tile: 9}]});
  const overlay = encodeOverlayFile({cells: [cell(), {...cell(), tile: 9}]});
  assert.deepEqual([...background], [7, 9, 0x92, 0x92]);
  assert.deepEqual([...overlay.slice(0, 2)], [...background.slice(0, 2)]);
  assert.deepEqual([...overlay.slice(1000, 1002)], [...background.slice(2)]);
  assert.equal(overlay.length, 2000);
});

test('set validation reports each cross-asset reference at its own path', () => {
  const set = {
    palettes: [], paletteConfigs: [], tilesets: [],
    backgrounds: [{format: 'clementina-background', version: 1, id: 'background:b', name: 'Back', width: 1, height: 1, tilesetId: 'missing', altTilesetId: 'other', cells: [cell()]}],
    overlays: [], shapes: [], animations: [], instruments: [], sounds: [], songs: [],
  };
  const checked = checkAssetSet(set);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.diagnostics.map(item => [item.code, item.path]), [
    ['asset.reference', '/backgrounds/0/tilesetId'],
    ['asset.reference', '/backgrounds/0/altTilesetId'],
  ]);
  set.backgrounds[0].width = 2;
  const malformed = checkAssetSet(set);
  assert.deepEqual(malformed.diagnostics.map(item => item.code), ['asset.background.cells']);
});

test('long notes split at the sequencer 24-bit duration limit without losing samples', () => {
  const instrument = {id: 'instrument:lead', wave: 1, pulse: 128, attack: 0, decay: 6, sustain: 10, release: 5, volume: 200};
  const note = {step: 0, length: 500, pitch: 57, instrumentId: 'instrument:lead'};
  const song = {bpm: 20, stepsPerBeat: 1, length: 500, voices: [{pan: 0, notes: [note]}, {pan: 0, notes: []}, {pan: 0, notes: []}, {pan: 0, notes: []}]};
  const track = compileSong(song, [instrument]).voices[0].bytes;
  assert.deepEqual([...track.slice(0, 2)], [SEQ_OP.SET_PAN, 0]);
  // After the instrument: one NOTE, then TIEs, so the note keeps its one attack.
  let samples = 0;
  let chunks = 0;
  for (let offset = 11; track[offset] === (chunks ? SEQ_OP.TIE : SEQ_OP.NOTE); offset += 6) {
    const duration = track[offset + 3] | (track[offset + 4] << 8) | (track[offset + 5] << 16);
    samples += duration;
    chunks++;
  }
  assert.equal(chunks, 3);
  assert.equal(samples, stepSample(song, song.length));
  assert.equal(track.at(-1), SEQ_OP.END);
});

test('a loop inside a note continues it and restores its instrument at the loop target', () => {
  const instrument = {id: 'instrument:lead', wave: 1, pulse: 128, attack: 0, decay: 6, sustain: 10, release: 5, volume: 200};
  const song = {bpm: 120, stepsPerBeat: 4, length: 4, loopStart: 2, voices: [
    {pan: 0, notes: [{step: 0, length: 4, pitch: 48, instrumentId: instrument.id}]},
    {pan: 0, notes: []}, {pan: 0, notes: []}, {pan: 0, notes: []},
  ]};
  const voice = compileSong(song, [instrument]).voices[0];
  assert.equal(voice.notes, 1);
  assert.equal(voice.bytes[voice.loop], SEQ_OP.SET_WAVE);
  assert.equal(voice.bytes[voice.loop + 9], SEQ_OP.TIE);
  assert.equal(voice.bytes.at(-4), SEQ_OP.JUMP);
});

test('each note starts with its own attack and a legato note carries on the one before it', () => {
  const instrument = {id: 'instrument:lead', wave: 1, pulse: 128, attack: 0, decay: 6, sustain: 10, release: 5, volume: 200};
  const note = (step, legato) => ({step, length: 1, pitch: 48 + step, instrumentId: instrument.id, legato});
  const song = {bpm: 120, stepsPerBeat: 4, length: 6, voices: [
    // A legato first note, a repeated note, a legato note, a rest, a legato note after the rest.
    {pan: 0, notes: [note(0, true), note(1), note(2, true), note(4, true)]},
    {pan: 0, notes: []}, {pan: 0, notes: []}, {pan: 0, notes: []},
  ]};
  const track = compileSong(song, [instrument]).voices[0].bytes;
  const timed = [];
  for (let offset = 11; offset < track.length - 1; offset += track[offset] === SEQ_OP.REST ? 4 : 6) timed.push(track[offset]);
  assert.deepEqual(timed, [SEQ_OP.NOTE, SEQ_OP.NOTE, SEQ_OP.TIE, SEQ_OP.REST, SEQ_OP.NOTE, SEQ_OP.REST]);
  assert.equal(track.at(-1), SEQ_OP.END);
});

test('the audio subpath retains Studio validation exports', () => {
  assert.throws(() => validateStudioSounds([{id: 'sound:s', name: 'Sound', attack: 0, decay: 0, sustain: 0, release: 0, pan: 0, frames: []}]), /1 to 600 frames/);
});
