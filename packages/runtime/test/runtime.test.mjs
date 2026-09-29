import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {bankLocation, runtimeDirectory, runtimeFiles, runtimeIncludes, runtimeSources} from '../dist/index.js';

test('bank locations encode the bank and the CPU window address', () => {
  assert.equal(bankLocation(0, 0x8000), 0x808000);
  assert.equal(bankLocation(31, 0xbfff), 0x9fbfff);
  assert.equal(bankLocation(4, 0x9123), 0x849123);
});

test('bank locations reject nonintegers and out-of-window values', () => {
  for (const bank of [-1, 32, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => bankLocation(bank, 0x8000), RangeError);
  }
  for (const address of [0x7fff, 0xc000, 32768.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => bankLocation(0, address), RangeError);
  }
});

test('the module manifest includes every packaged ca65 source and include', async () => {
  const files = await readdir(runtimeDirectory);
  assert.deepEqual([...runtimeSources].sort(), files.filter(file => file.endsWith('.s')).sort());
  assert.deepEqual([...runtimeIncludes].sort(), files.filter(file => file.endsWith('.inc')).sort());
});

test('embedded runtime files match the packaged ca65 sources', async () => {
  assert.deepEqual(Object.keys(runtimeFiles).sort(), [...runtimeIncludes, ...runtimeSources].sort());
  for (const [name, text] of Object.entries(runtimeFiles)) assert.equal(text, await readFile(join(runtimeDirectory, name), 'utf8'), name);
});
