import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {byteNames, duplicateNames, loadSpecs, miaSymbols, programSections} from '../scripts/generate-includes.mjs';
import {runtimeDirectory} from '../packages/runtime/dist/index.js';

const specs = loadSpecs();
const hasCa65 = spawnSync('ca65', ['--version'], {stdio: 'ignore'}).status === 0;

test('include names follow MIA byte naming and never repeat', () => {
  assert.deepEqual(byteNames('MODE', 1), ['MODE']);
  assert.deepEqual(byteNames('ADDR', 2), ['ADDR_L', 'ADDR_H']);
  assert.deepEqual(byteNames('DEST', 3), ['DEST_L', 'DEST_M', 'DEST_H']);
  assert.deepEqual(byteNames('LEN', 4), ['LEN0', 'LEN1', 'LEN2', 'LEN3']);
  assert.deepEqual(byteNames('NAME', 244), ['NAME']);
  assert.deepEqual(duplicateNames(specs), []);
});

test('clementina.inc assembles and every symbol has its spec value', {skip: !hasCa65}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clementina-includes-'));
  const symbols = [...miaSymbols(specs), ...programSections(specs).flatMap(s => s.symbols)];
  const source = ['.include "clementina.inc"', '.include "clementina.inc"', ...symbols.map(s => `.assert ${s.name} = ${s.value}, error, "${s.name}"`), ''].join('\n');
  await writeFile(join(dir, 'check.s'), source);
  const run = spawnSync('ca65', ['--cpu', '65C02', '--include-dir', runtimeDirectory, '-o', join(dir, 'check.o'), join(dir, 'check.s')], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
});
