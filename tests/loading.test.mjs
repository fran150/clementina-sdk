import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBootstrapSource,
  checkLoadPlan,
  encodePrg,
  inspectPrg,
  renderBootstrapSource,
} from '../packages/basic/dist/index.js';

const plan = {
  format: 'clementina-load-plan', version: 1,
  steps: [
    {kind: 'mia', path: 'ASSETS/PALETTE.BIN', address: 256, length: 256},
    {kind: 'prg', path: 'BANK1.PRG', loadAddress: 0x8000, bank: 1, length: 0x4000},
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x6000, length: 10, runAddress: 0x6000},
  ],
};

test('load plans render ordered ROM BASIC bootstrap source', () => {
  assert.equal(checkLoadPlan(plan).ok, true);
  assert.equal(renderBootstrapSource(plan), [
    '10 MIALOAD "ASSETS/PALETTE.BIN",256,256',
    '20 BLOAD "BANK1.PRG"',
    '30 BLOAD "GAME.PRG",24576',
    '',
  ].join('\n'));
});

test('load plans enforce terminal takeover and explicit unresolved-overlap acknowledgement', () => {
  const overlap = {format: 'clementina-load-plan', version: 1, steps: [
    {kind: 'mia', path: 'TRACK.BIN', address: 0x13000, length: 16},
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x6000, length: 1, runAddress: 0x6000},
  ]};
  assert.ok(checkLoadPlan(overlap).diagnostics.some(d => d.code === 'load.known-issue'));
  assert.equal(checkLoadPlan({...overlap, acknowledgedIssues: ['audio-sequencer-sd-memory-overlap']}).ok, true);
  for (const changed of [
    {...plan, steps: plan.steps.slice(0, 2)},
    {...plan, steps: [plan.steps[2], plan.steps[0]]},
    {...plan, steps: [{kind: 'prg', path: 'LOW.PRG', loadAddress: 0x2000, length: 1}, plan.steps[2]]},
    {...plan, steps: [{kind: 'mia', path: '../BAD.BIN', address: 0, length: 1}, plan.steps[2]]},
    {...plan, steps: [{kind: 'mia', path: 'TOO-LARGE.BIN', address: 0x3ffff, length: 2}, plan.steps[2]]},
  ]) assert.equal(checkLoadPlan(changed).ok, false);
  assert.equal(checkBootstrapSource({...plan, steps: [
    {kind: 'mia', path: `${'A'.repeat(60)}.BIN`, address: 256, length: 1}, plan.steps[2],
  ]}).ok, false);
});

test('PRG helpers implement and validate unbanked and banked headers', () => {
  const payload = Uint8Array.of(0xa9, 42, 0x60);
  const plain = encodePrg(payload, 0x6000);
  assert.deepEqual(Array.from(plain), [0x00, 0x60, ...payload]);
  assert.deepEqual(inspectPrg(plain), {loadAddress: 0x6000, headerLength: 2, payloadLength: 3});
  const banked = encodePrg(payload, 0x8000, 7);
  assert.deepEqual(Array.from(banked), [0x00, 0x80, 7, ...payload]);
  assert.deepEqual(inspectPrg(banked), {loadAddress: 0x8000, bank: 7, headerLength: 3, payloadLength: 3});
  assert.throws(() => encodePrg(payload, 0x8000), /Bank/);
  assert.throws(() => encodePrg(payload, 0x6000, 1), /must not declare/);
  assert.throws(() => inspectPrg(Uint8Array.of(0, 0x80, 0, 1)), /bank|>= 1/i);
  assert.throws(() => encodePrg(new Uint8Array(0), 0x6000), /non-empty/);
});
