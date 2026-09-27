import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkStudioProjectV2, normalizeStudioProjectV2, validateStudioProject, fromStudioProjectV2} from '@clementina/project';

const fixture = async () => JSON.parse(await readFile(new URL('fixtures/studio-v2.json', import.meta.url), 'utf8'));
const changed = (source, edit) => {const value = structuredClone(source); edit(value); return value;};

test('Studio v2 normalization preserves session data and fills absent collections', async () => {
  const original = await fixture();
  const older = changed(original, p => {
    delete p.backgrounds;
    delete p.overlays;
    delete p.instruments;
    delete p.sounds;
    delete p.songs;
    p.tilesets[0].previewBackground = '#123456';
    p.builder = {selection: 'session only'};
  });
  const checked = checkStudioProjectV2(older);
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
  assert.equal(older.backgrounds, undefined);
  assert.deepEqual(checked.value.backgrounds, []);
  assert.equal(checked.value.tilesets[0].previewBackground, '#123456');
  assert.deepEqual(checked.value.builder, older.builder);
  assert.deepEqual(normalizeStudioProjectV2(older), checked.value);
});

test('legacy identities and optional bindings remain valid in Studio sessions', async () => {
  const original = await fixture();
  const legacy = changed(original, p => {
    p.paletteLibrary[0].id = 'palette with spaces';
    p.paletteConfigs[0].banks[0] = 'palette with spaces';
    p.tilesets[0].id = 'tileset with spaces';
    for (const asset of [...p.backgrounds, ...p.overlays]) {
      asset.tilesetId = 'tileset with spaces';
      asset.altTilesetId = 'tileset with spaces';
    }
    p.shapes[0].tilesetId = undefined;
    delete p.animations[0].id;
    p.shapes[0].canvasWidth = 8;
    p.shapes[0].canvasHeight = 8;
    p.paletteLibrary[0].name = 'P'.repeat(65);
    p.paletteConfigs[0].name = 'C'.repeat(65);
  });
  validateStudioProject(legacy);
  assert.equal(checkStudioProjectV2(legacy).ok, true);
  assert.equal(legacy.shapes[0].tilesetId, undefined);
  // Export is an explicit conversion: it may resolve a missing binding when
  // there is exactly one tileset, while Studio validation keeps the session.
  assert.throws(() => fromStudioProjectV2(legacy));
});

test('Studio v2 rejects broken references, ranges and duplicate identities', async () => {
  const source = await fixture();
  const invalid = [
    p => {p.activeConfigId = 'missing';},
    p => {p.paletteConfigs[0].banks[0] = 'missing';},
    p => {p.tilesets[0].chr.pop();},
    p => {p.backgrounds[0].tilesetId = 'missing';},
    p => {p.overlays[0].placeholders[0].width = 41;},
    p => {p.shapes[0].sprites[0].x = 512;},
    p => {p.animations[0].frames[0].shapeId = 'missing';},
    p => {p.animations[0].frames[0].ticks = 0;},
    p => {p.animations.push({...p.animations[0]});},
    p => {p.instruments[0].sustain = 16;},
    p => {p.sounds[0].frames[0].wave = 5;},
    p => {p.songs[0].voices[0].notes[0].instrumentId = 'missing';},
    p => {p.songs[0].voices.pop();},
  ];
  for (const edit of invalid) {
    const value = changed(source, edit);
    assert.equal(checkStudioProjectV2(value).ok, false);
    assert.throws(() => validateStudioProject(value));
  }
  assert.equal(checkStudioProjectV2(null).ok, false);
  assert.equal(checkStudioProjectV2([]).ok, false);
});
