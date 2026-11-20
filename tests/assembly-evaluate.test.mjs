import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCa65Debug} from '@clementina/assembler';
import {AssemblySymbols, ClementinaProjectDebugSession, describeSymbol, evaluateRegister} from '@clementina/debug';
import {sourceLanguage} from '../packages/debug-adapter/dist/protocol.js';

const debug = parseCa65Debug([
  'version\tmajor=2,minor=0',
  'sym\tid=0,name="hello",addrsize=absolute,scope=0,def=1,val=0x7000,seg=0,type=lab',
  'sym\tid=1,name="@next",addrsize=absolute,parent=0,def=2,val=0x7002,seg=0,type=lab',
  'sym\tid=2,name="other",addrsize=absolute,scope=0,def=3,val=0x7100,seg=0,type=lab',
  'sym\tid=3,name="@next",addrsize=absolute,parent=2,def=4,val=0x7104,seg=0,type=lab',
  'sym\tid=4,name="KERN_CHROUT",addrsize=absolute,scope=0,def=5,val=0x406,type=equ',
  'sym\tid=5,name="KERN_CHROUT",addrsize=absolute,scope=1,def=6,val=0x406,type=equ',
  'sym\tid=6,name="routine",addrsize=absolute,scope=0,type=imp',
].join('\n'));

test('assembly symbols resolve constants, labels and the cheap local of the running routine', () => {
  const symbols = new AssemblySymbols(debug.symbols);
  assert.deepEqual(describeSymbol(symbols.find('KERN_CHROUT')), {name: 'KERN_CHROUT', value: '$0406 (1030)', type: 'constant'});
  assert.deepEqual(describeSymbol(symbols.find('hello'), [0xa2, 0x00, null]), {name: 'hello', value: '$7000: A2 00 ??', type: 'label'});
  assert.equal(symbols.find('@next', 0x7003).value, 0x7002);
  assert.equal(symbols.find('@next', 0x7106).value, 0x7104);
  assert.equal(symbols.find('routine'), undefined);
  assert.equal(symbols.find('missing'), undefined);
});

test('registers evaluate by their usual names, with P as flags', () => {
  const registers = {pc: 0x7004, a: 0x48, x: 3, y: 0, sp: 0xfd, p: 0b1000_0011};
  assert.deepEqual(evaluateRegister('a', registers), {name: 'A', value: '$48 (72)', type: 'register'});
  assert.equal(evaluateRegister('PC', registers).value, '$7004');
  assert.equal(evaluateRegister('P', registers).value, '$83 Nv-bdiZC %10000011');
  assert.equal(evaluateRegister('hello', registers), undefined);
});

test('a combined session asks the hovered language first and keeps BASIC A away from the register', async () => {
  const asked = [];
  const assembly = {
    snapshot: async () => ({frame: {locations: []}}),
    evaluate: async name => { asked.push(`asm:${name}`); return name === 'A' || name === 'KERN_CHROUT' ? {name, value: 'asm', type: 'register'} : undefined; },
  };
  const basic = {evaluate: async name => { asked.push(`basic:${name}`); return name === 'B' ? {name, value: '1', type: 'number'} : undefined; }};
  const session = new ClementinaProjectDebugSession(basic, assembly);
  assert.equal((await session.evaluate('A', 'assembly')).value, 'asm');
  assert.equal(await session.evaluate('A', 'basic'), undefined);
  assert.equal((await session.evaluate('KERN_CHROUT', 'basic')).value, 'asm');
  assert.equal((await session.evaluate('B')).value, '1');
  assert.deepEqual(asked, ['asm:A', 'basic:A', 'basic:KERN_CHROUT', 'asm:KERN_CHROUT', 'basic:B']);
});

test('hover language comes from the file extension', () => {
  assert.equal(sourceLanguage('/p/src/hello.s'), 'assembly');
  assert.equal(sourceLanguage('/p/lib/clementina.inc'), 'assembly');
  assert.equal(sourceLanguage('/p/src/main.cbas'), 'basic');
  assert.equal(sourceLanguage(undefined), undefined);
});
