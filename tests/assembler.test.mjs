import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildAssembly, createAssemblySourceMap, parseCa65Debug} from '../packages/assembler/dist/index.js';

test('ld65 debug records expose source, segment, line, and symbol mappings', () => {
  const parsed = parseCa65Debug([
    'version\tmajor=2,minor=0',
    'file\tid=0,name="src/main.s",size=10,mtime=0x1,mod=0',
    'line\tid=2,file=0,line=7,span=3+4,type=1,count=2',
    'seg\tid=1,name="CODE",start=0x006000,size=0x0003,addrsize=absolute,type=ro,oname="build/game.bin",ooffs=0',
    'span\tid=3,seg=1,start=0,size=2',
    'span\tid=4,seg=1,start=2,size=1,type=8',
    'sym\tid=4,name="game_start",addrsize=absolute,size=3,scope=0,def=2,val=0x6000,seg=1,type=lab',
    '',
  ].join('\n'));
  assert.deepEqual(parsed.version, {major: 2, minor: 0});
  assert.deepEqual(parsed.files, [{id: 0, path: 'src/main.s'}]);
  assert.deepEqual(parsed.lines, [{id: 2, fileId: 0, line: 7, spanIds: [3, 4], type: 1, count: 2}]);
  assert.deepEqual(parsed.segments, [{id: 1, name: 'CODE', start: 0x6000, size: 3, outputName: 'build/game.bin', outputOffset: 0}]);
  assert.deepEqual(parsed.spans, [
    {id: 3, segmentId: 1, start: 0, size: 2},
    {id: 4, segmentId: 1, start: 2, size: 1, typeId: 8},
  ]);
  assert.deepEqual(parsed.symbols, [{id: 4, name: 'game_start', value: 0x6000, segmentId: 1, definitionLineId: 2, scopeId: 0, type: 'lab'}]);
  assert.throws(() => parseCa65Debug('version\tmajor=1,minor=0\n'), /Unsupported/);
});

test('source maps resolve exact lines and containing addresses without inventing executable code', () => {
  const debug = parseCa65Debug([
    'version\tmajor=2,minor=0',
    'file\tid=0,name="src\\\\main.s"',
    'line\tid=0,file=0,line=4,span=0+1',
    'line\tid=1,file=0,line=5',
    'seg\tid=0,name="CODE",start=0x008000,size=0x0005',
    'span\tid=0,seg=0,start=0,size=2',
    'span\tid=1,seg=0,start=4,size=1',
    '',
  ].join('\n'));
  const sourceMap = createAssemblySourceMap(debug, {bank: 7});
  assert.deepEqual(sourceMap.executableLines('src/main.s'), [4]);
  assert.deepEqual(sourceMap.locationsForSource('./src/main.s', 4).map(({address, size, bank}) => ({address, size, bank})), [
    {address: 0x8000, size: 2, bank: 7},
    {address: 0x8004, size: 1, bank: 7},
  ]);
  assert.equal(sourceMap.locationsForSource('src/main.s', 5).length, 0);
  assert.deepEqual(sourceMap.locationsForAddress(0x8001, 7).map(location => location.line), [4]);
  assert.equal(sourceMap.locationsForAddress(0x8001, 0).length, 0);
  assert.equal(sourceMap.locationsForAddress(0x8001, 8).length, 0);
  assert.equal(sourceMap.locationsForAddress(0x8003).length, 0);
});

test('source maps deduplicate repeated spans and ignore invalid ranges', () => {
  const debug = parseCa65Debug([
    'version\tmajor=2,minor=0',
    'file\tid=0,name="src/first.s"',
    'file\tid=1,name="src/second.s"',
    'line\tid=0,file=0,line=10,span=0+1+2',
    'line\tid=1,file=0,line=10,span=0',
    'line\tid=2,file=1,line=3,span=0',
    'seg\tid=0,name="CODE",start=0x008000,size=4',
    'span\tid=0,seg=0,start=0,size=2',
    'span\tid=1,seg=0,start=2,size=0',
    'span\tid=2,seg=0,start=0x8000,size=1',
  ].join('\n'));
  const sourceMap = createAssemblySourceMap(debug, {bank: 7});

  assert.deepEqual(sourceMap.executableLines('src/first.s'), [10]);
  assert.deepEqual(sourceMap.locationsForSource('src/first.s', 10).map(({address, spanId}) => ({address, spanId})), [
    {address: 0x8000, spanId: 0},
  ]);
  assert.deepEqual(sourceMap.locationsForAddress(0x8001, 7).map(location => location.path), [
    'src/first.s', 'src/second.s',
  ]);
  assert.equal(sourceMap.locationsForAddress(0x8001, 8).length, 0);
  assert.throws(() => createAssemblySourceMap(debug, {bank: 32}), RangeError);
});

const hasCc65 = spawnSync('ca65', ['--version'], {stdio: 'ignore'}).status === 0
  && spawnSync('ld65', ['--version'], {stdio: 'ignore'}).status === 0;

test('assembler builds multiple sources, verifies placement, and emits a terminal PRG step', {skip: !hasCc65}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-assembler-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'main.s'), [
    '.setcpu "65C02"', '.import answer', '.export game_start', '.segment "CODE"',
    '.proc game_start', '  lda answer', '  rts', '.endproc', '',
  ].join('\n'));
  await writeFile(join(root, 'src', 'data.s'), [
    '.setcpu "65C02"', '.export answer', '.segment "RODATA"', 'answer: .byte $2A', '',
  ].join('\n'));
  await writeFile(join(root, 'link.cfg'), [
    'MEMORY { RAM: start=$6000, size=$1000, type=rw, file=%O; }',
    'SEGMENTS { CODE: load=RAM, type=ro; RODATA: load=RAM, type=ro; }', '',
  ].join('\n'));

  const built = await buildAssembly(root, {
    sources: ['src/main.s', 'src/data.s'], linkerConfig: 'link.cfg',
    outputDirectory: 'build', outputName: 'game', loadAddress: 0x6000,
    entrySymbol: 'game_start',
  });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.equal(built.value.entryAddress, 0x6000);
  assert.deepEqual(built.value.loadStep, {
    kind: 'prg', path: 'build/game.prg', loadAddress: 0x6000,
    length: 5, runAddress: 0x6000,
  });
  assert.deepEqual(Array.from(built.value.prg), [0x00, 0x60, 0xad, 0x04, 0x60, 0x60, 0x2a]);
  assert.deepEqual(new Uint8Array(await readFile(join(root, 'build', 'game.prg'))), built.value.prg);
  assert.equal(built.value.debug.files.length, 2);
  const sourceMap = createAssemblySourceMap(built.value.debug);
  assert.deepEqual(sourceMap.locationsForSource('src/main.s', 6).map(location => location.address), [0x6000]);
  assert.deepEqual(sourceMap.locationsForSource('src/main.s', 7).map(location => location.address), [0x6003]);
  assert.deepEqual(sourceMap.locationsForAddress(0x6002).map(location => [location.path, location.line]), [['src/main.s', 6]]);

  const mismatch = await buildAssembly(root, {
    sources: ['src/main.s', 'src/data.s'], linkerConfig: 'link.cfg',
    outputDirectory: 'other', outputName: 'game', loadAddress: 0x6100,
    entrySymbol: 'game_start',
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.diagnostics.some(item => item.code === 'assembler.image.placement'));
});

test('assembler rejects implicit placement and unsafe build inputs before invoking tools', async () => {
  let invoked = false;
  const built = await buildAssembly('.', {
    sources: ['../main.s'], linkerConfig: 'link.cfg', outputDirectory: 'build',
    outputName: 'game.bin', loadAddress: 0x8000, entrySymbol: 'start',
  }, async () => { invoked = true; return {exitCode: 0, stdout: '', stderr: ''}; });
  assert.equal(built.ok, false);
  assert.equal(invoked, false);
  assert.ok(built.diagnostics.some(item => item.code === 'assembler.path'));
  assert.ok(built.diagnostics.some(item => item.code === 'assembler.bank'));
  assert.ok(built.diagnostics.some(item => item.code === 'assembler.output-name'));
});

test('assembler stops at the failing tool and reports its source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-assembler-tools-'));
  const request = {
    sources: ['main.s'], linkerConfig: 'link.cfg',
    outputDirectory: 'build', outputName: 'game',
    loadAddress: 0x6000, entrySymbol: 'start',
  };

  const assembleFailure = await buildAssembly(root, request, async ({command}) => {
    assert.equal(command, 'ca65');
    return {exitCode: 1, stdout: '', stderr: 'assembly failed'};
  });
  assert.equal(assembleFailure.ok, false);
  assert.deepEqual(assembleFailure.diagnostics.map(({code, source, message}) => ({code, source, message})), [
    {code: 'assembler.tool', source: 'main.s', message: 'assembly failed'},
  ]);

  const commands = [];
  const linkFailure = await buildAssembly(root, request, async ({command}) => {
    commands.push(command);
    return command === 'ca65'
      ? {exitCode: 0, stdout: '', stderr: ''}
      : {exitCode: 1, stdout: '', stderr: 'link failed'};
  });
  assert.equal(linkFailure.ok, false);
  assert.deepEqual(commands, ['ca65', 'ld65']);
  assert.deepEqual(linkFailure.diagnostics.map(({code, source, message}) => ({code, source, message})), [
    {code: 'assembler.tool', source: 'link.cfg', message: 'link failed'},
  ]);
});
