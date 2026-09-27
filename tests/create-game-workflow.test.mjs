import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildProject} from '@clementina/build';
import {loadProject} from '@clementina/project/node';
import {initGame} from '../agents/workflows/create-game.mjs';

test('BASIC game workflow creates a buildable portable project and checks asset IDs', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-create-game-'));
  const projectRoot = join(temporary, 'game');
  try {
    await initGame(projectRoot, 'Workflow Test');
    await assert.rejects(initGame(projectRoot), /already exists/);
    const loaded = await loadProject(projectRoot);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.diagnostics));
    assert.equal(loaded.value.manifest.name, 'Workflow Test');
    assert.equal(loaded.value.assets.paletteConfigs[0].banks[0], 'palette:main');
    const built = await buildProject(projectRoot);
    assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
    assert.equal(built.value.kind, 'basic');
    assert.deepEqual(built.value.loadPlan.steps.map(step => step.kind), ['mia', 'basic']);
    assert.ok((await readFile(join(projectRoot, 'build/game.bas'))).length > 0);

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
