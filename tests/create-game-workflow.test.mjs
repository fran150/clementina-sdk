import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildProject} from '@clementina/build';
import {loadProject} from '@clementina/project/node';
import {initGame} from '../agents/workflows/create-game.mjs';

const hasTools = ['ca65', 'ld65', 'ar65'].every(t => spawnSync(t, [t === 'ar65' ? 'V' : '--version'], {stdio: 'ignore'}).status === 0);

test('game workflow creates a portable project with a BASIC program and assembly, and checks asset IDs', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-create-game-'));
  const projectRoot = join(temporary, 'game');
  try {
    await initGame(projectRoot, 'Workflow Test');
    await assert.rejects(initGame(projectRoot), /already exists/);
    const loaded = await loadProject(projectRoot);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
    assert.equal(loaded.value.manifest.name, 'Workflow Test');
    assert.equal(loaded.value.manifest.program.entry, 'src/main.bas');
    assert.deepEqual(loaded.value.manifest.build.assembly.sources, ['src/score.s']);
    assert.equal(loaded.value.assets.paletteConfigs[0].banks[0], 'palette:main');

    const palettePath = join(projectRoot, 'assets/palettes/main.palette.json');
    const palette = JSON.parse(await readFile(palettePath, 'utf8'));
    palette.id = 'palette:other';
    await writeFile(palettePath, JSON.stringify(palette));
    const invalid = await loadProject(projectRoot);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.diagnostics.some(d => d.code.includes('reference')));
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});

test('the starter builds: memoryTop, then the palette, the PRG above it and the BASIC program', {skip: !hasTools}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-create-game-build-'));
  const projectRoot = join(temporary, 'game');
  try {
    await initGame(projectRoot);
    const built = await buildProject(projectRoot);
    assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
    assert.deepEqual(built.diagnostics, []);
    assert.equal(built.value.assembly.entryAddress, 0x7000);
    assert.deepEqual(built.value.loadPlan.steps.map(step => step.kind), ['memoryTop', 'mia', 'prg', 'basic']);
    assert.ok((await readFile(join(projectRoot, 'build/game.bas'))).length > 0);
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});
