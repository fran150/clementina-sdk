import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';
import {checkProjectManifest, manifestText} from '@clementina/project';
import {loadProject, saveProject} from '@clementina/project/node';

const written = `# Ruben's underworld
format: clementina-project
version: 1
name: Ruben   # the hero
target: {machine: clementina-6502}
program:
  entry: src/main.cbas
assets:
  palettes: []   # colors come later
  paletteConfigs: []
  tilesets: []
  backgrounds: []
  overlays: []
  shapes: []
  animations: []
build:
  outputDirectory: build
  basic:
    outputName: game
    memoryTop: $7000   # code lives above
  assembly:
    sources: [src/hello.s]
    linkerConfig: src/link.cfg
    outputName: code
    loadAddress: 0x7000
    entrySymbol: start
`;
const manifest = () => checkProjectManifest(parse(written)).value;

test('an unchanged manifest is written back byte for byte, hex addresses and all', () => {
  assert.equal(manifestText(manifest(), written), written);
});

test('a changed manifest keeps its comments and hex addresses, and new addresses are written in hex', () => {
  const m = manifest();
  m.name = 'Ruben 2';
  m.assets.shapes.push('assets/hero.shape.json');
  m.build.assets = {slots: [{name: 'music', mia: 0x14000, size: 8192}, {name: 'map', bank: 2, address: 0x8000, size: 4096}]};
  const text = manifestText(m, written);
  for (const kept of ["# Ruben's underworld", 'name: Ruben 2 # the hero', '# colors come later', 'memoryTop: $7000 # code lives above', 'loadAddress: 0x7000', 'target: {machine: clementina-6502}', 'sources: [src/hello.s]']) {
    assert.ok(text.includes(kept), `${kept}\n${text}`);
  }
  assert.ok(text.includes('shapes: [assets/hero.shape.json]'), text);
  assert.match(text, /mia: \$14000\n/);
  assert.match(text, /address: \$8000\n/);
  assert.match(text, /size: 8192\n/);
  assert.deepEqual(parse(text).build.assets.slots[0], {name: 'music', mia: '$14000', size: 8192});
});

test('a changed address is rewritten in hex; removed fields go', () => {
  const m = manifest();
  m.build.assembly.loadAddress = 0x6000;
  delete m.build.basic.memoryTop;
  const text = manifestText(m, written);
  assert.match(text, /loadAddress: \$6000\n/);
  assert.doesNotMatch(text, /memoryTop/);
});

test('a new manifest writes addresses in hex', () => {
  const text = manifestText(manifest());
  assert.match(text, /memoryTop: \$7000\n/);
  assert.match(text, /loadAddress: \$7000\n/);
  assert.deepEqual(checkProjectManifest(parse(text)).value, manifest());
});

test('saveProject keeps the comments and hex of the clementina.yaml it replaces', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-manifest-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await cp(new URL('../examples/minimal-game/', import.meta.url), root, {recursive: true});
  const original = await readFile(join(root, 'clementina.yaml'), 'utf8');
  await writeFile(join(root, 'clementina.yaml'), `# notes kept\n${original}`);
  const loaded = await loadProject(root);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
  await saveProject(root, loaded.value);
  assert.equal(await readFile(join(root, 'clementina.yaml'), 'utf8'), `# notes kept\n${original}`);
});
