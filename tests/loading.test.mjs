import test from 'node:test';
import assert from 'node:assert/strict';
import {
  basicTokenTables,
  checkBootstrapSource,
  checkLoadPlan,
  compileBasicProgram,
  detokenizeBasicProgram,
  encodePrg,
  inspectBasicProgram,
  inspectPrg,
  parseBasicSource,
  renderBootstrapSource,
  tokenizeBasicLine,
} from '../packages/basic/dist/index.js';
import {readFile} from 'node:fs/promises';

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

test('load plans enforce terminal takeover and the permanently reserved SD/FS region', () => {
  const overlap = {format: 'clementina-load-plan', version: 1, steps: [
    {kind: 'mia', path: 'TRACK.BIN', address: 0x13000, length: 16},
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x6000, length: 1, runAddress: 0x6000},
  ]};
  assert.ok(checkLoadPlan(overlap).diagnostics.some(d => d.code === 'load.mia.reserved'));
  assert.equal(checkLoadPlan({...overlap, steps: [
    {kind: 'mia', path: 'TRACK.BIN', address: 0x14000, length: 16}, overlap.steps[1],
  ]}).ok, true);
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

test('BASIC token tables stay synchronized with the developer spec', async () => {
  const spec=JSON.parse(await readFile(new URL('../specs/basic.json',import.meta.url),'utf8'));
  assert.deepEqual(basicTokenTables.primary,spec.tokens.primary);
  assert.deepEqual(basicTokenTables.extension,spec.tokens.extension);
  assert.deepEqual(basicTokenTables.extension2,spec.tokens.extension2);
  assert.deepEqual(basicTokenTables.extensionFunction,spec.tokens.extensionFunction);
  assert.equal(basicTokenTables.mon,spec.tokens.special.MON);
});

test('BASIC tokenizer follows ROM table order and lexical modes', () => {
  assert.deepEqual(Array.from(tokenizeBasicLine('print "Hello World";ticks(0):rem Keep This')), [
    0x9d,0x20,0x22,...Buffer.from('Hello World'),0x22,0x3b,0xfd,0x8b,0x28,0x30,0x29,0x3a,0x8e,...Buffer.from(' Keep This'),
  ]);
  assert.deepEqual(Array.from(tokenizeBasicLine('miaload "A B",256:sys 24576')), [
    0xfc,0x8c,0x20,0x22,0x41,0x20,0x42,0x22,0x2c,0x32,0x35,0x36,0x3a,0xfc,0xa7,0x20,0x32,0x34,0x35,0x37,0x36,
  ]);
  assert.deepEqual(Array.from(tokenizeBasicLine('data a b,"c d":goto 10')), [0x83,0x20,0x61,0x20,0x62,0x2c,0x22,0x63,0x20,0x64,0x22,0x3a,0x88,0x20,0x31,0x30]);
  assert.deepEqual(Array.from(tokenizeBasicLine('mon:money=1:?money')), [0xfe,0x3a,0x4d,0x90,0x45,0x59,0xb2,0x31,0x3a,0x9d,0x4d,0x90,0x45,0x59]);
});

test('BASIC compiler emits LOAD-ready links and exact absolute line records', () => {
  const source='20 print "TWO"\n10 ? "ONE"\n30 rem done\n';
  assert.deepEqual(parseBasicSource(source).map(line=>line.number),[10,20,30]);
  const relocatable=compileBasicProgram(source);
  const inspected=inspectBasicProgram(relocatable);
  assert.equal(inspected.relocatableLinks,true);
  assert.deepEqual(inspected.lines.map(line=>line.nextAddress),[0xffff,0xffff,0xffff]);
  assert.equal(detokenizeBasicProgram(relocatable),'10 PRINT "ONE"\n20 PRINT "TWO"\n30 REM done\n');

  const absolute=compileBasicProgram(source,{baseAddress:0x6000});
  const exact=inspectBasicProgram(absolute,{baseAddress:0x6000});
  assert.equal(exact.relocatableLinks,false);
  assert.deepEqual(exact.lines.map(line=>line.nextAddress),exact.lines.map((line,index)=>0x6000+(exact.lines[index+1]?.offset??absolute.length-2)));
  assert.deepEqual(Array.from(absolute.slice(-2)),[0,0]);
});

test('BASIC compiler mirrors editor replacement/deletion and rejects unsafe source', () => {
  assert.equal(detokenizeBasicProgram(compileBasicProgram('10 PRINT 1\n10 PRINT 2\n20\n')),'10 PRINT 2\n');
  for(const source of ['PRINT 1','64000 PRINT 1',`10 ${'A'.repeat(69)}`,'10 PRINT "é"']) {
    assert.throws(()=>compileBasicProgram(source));
  }
  assert.throws(()=>inspectBasicProgram(Uint8Array.of(0xff,0xff,10,0,0,0)),/end marker|forward link|bytes follow/i);
});

test('BASIC inspector validates and exposes Clementina styled-literal sidecars',()=>{
  const styled=Uint8Array.of(
    0xff,0xff,10,0,0x9d,0x22,0x41,0x22,0,
    0xce,0xff,7,1,2,1,5,
    0,0,
  );
  assert.deepEqual(inspectBasicProgram(styled).lines[0].styles,[{literalOffset:2,attributes:[5]}]);
  assert.equal(detokenizeBasicProgram(styled),'10 PRINT"A"\n');
  const invalid=styled.slice();invalid[13]=1;
  assert.throws(()=>inspectBasicProgram(invalid),/quoted literal/);
});
