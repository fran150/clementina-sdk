import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildProject} from '../packages/build/dist/index.js';
import {compileBasicProgram} from '../packages/basic/dist/index.js';
import {runtimeFiles} from '../packages/runtime/dist/index.js';

const arg = (args, name) => args[args.indexOf(name) + 1];

async function deterministicTools(invocation) {
  if (invocation.command === 'ca65') {
    await writeFile(arg(invocation.args, '-o'), 'object');
    if (invocation.args.includes('--listing')) await writeFile(arg(invocation.args, '--listing'), 'listing');
    return {exitCode: 0, stdout: '', stderr: ''};
  }
  if (invocation.command === 'ar65') {
    assert.equal(invocation.args[0], 'r');
    await writeFile(invocation.args[1], 'library');
    return {exitCode: 0, stdout: '', stderr: ''};
  }
  if (invocation.command === 'ld65') {
    const binary = arg(invocation.args, '-o');
    const debug = arg(invocation.args, '--dbgfile');
    await writeFile(binary, Uint8Array.of(0xa9, 0x2a, 0x60));
    await writeFile(debug, [
      'version\tmajor=2,minor=0',
      'file\tid=0,name="src/main.s",size=1,mtime=0x0,mod=0',
      `seg\tid=0,name="CODE",start=0x006000,size=0x0003,addrsize=absolute,type=ro,oname=${JSON.stringify(binary)},ooffs=0`,
      'sym\tid=0,name="game_start",addrsize=absolute,size=3,scope=0,def=0,val=0x6000,seg=0,type=lab',
      '',
    ].join('\n'));
    await writeFile(arg(invocation.args, '--mapfile'), 'map');
    await writeFile(arg(invocation.args, '-Ln'), 'labels');
    return {exitCode: 0, stdout: '', stderr: ''};
  }
  return {exitCode: 1, stdout: '', stderr: `Unexpected tool ${invocation.command}`};
}

test('project build emits explicit video placements, terminal PRG, load plan, and bootstrap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-build-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'config'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'src', 'main.s'), '; main\n');
  await writeFile(join(root, 'src', 'player.s'), '; player\n');
  await writeFile(join(root, 'config', 'game.cfg'), '# linker\n');
  const palette = {format: 'clementina-palette', version: 1, id: 'palette:main', name: 'Main', colors: [0, 0x1234, 2, 3, 4, 5, 6, 7]};
  const paletteConfig = {format: 'clementina-palette-config', version: 1, id: 'palette-config:main', name: 'Main', banks: ['palette:main', ...Array(15).fill(null)]};
  const tileset = {format: 'clementina-tileset', version: 1, id: 'tileset:main', name: 'Main', bpp: 3, chr: Array(6144).fill(0), authoring: {tilePaletteBanks: Array(256).fill(0), compositions: []}};
  tileset.chr[0] = 0x80;
  await writeFile(join(root, 'assets', 'palette.json'), JSON.stringify(palette));
  await writeFile(join(root, 'assets', 'palette-config.json'), JSON.stringify(paletteConfig));
  await writeFile(join(root, 'assets', 'tileset.json'), JSON.stringify(tileset));
  await writeFile(join(root, 'clementina.yaml'), [
    'format: clementina-project', 'version: 1', 'name: Build Test',
    'target:', '  machine: clementina-6502',
    'assets:', '  palettes: [assets/palette.json]', '  paletteConfigs: [assets/palette-config.json]',
    '  tilesets: [assets/tileset.json]', '  backgrounds: []', '  overlays: []', '  shapes: []', '  animations: []',
    'build:', '  outputDirectory: build', '  assembly:', '    sources: [src/main.s, src/player.s]', '    linkerConfig: config/game.cfg',
    '    outputName: game', '    loadAddress: 24576', '    entrySymbol: game_start',
    '  video:', '    paletteConfigId: palette-config:main', '    tilesets:',
    '      - tilesetId: tileset:main', '        bank: 3', '',
  ].join('\n'));

  const programRuns = [];
  const built = await buildProject(root, async invocation => {
    if (invocation.command === 'ca65' && invocation.args.some(a => a.endsWith('main.s'))) programRuns.push(invocation.args);
    return deterministicTools(invocation);
  });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  // Every assembly program gets clementina.inc and mia.inc on its include path.
  assert.equal(programRuns.length, 1);
  assert.ok(programRuns[0].some((a, i) => programRuns[0][i - 1] === '--include-dir' && a.replace(/\\/g, '/').endsWith('build/include')));
  for (const name of ['clementina.inc', 'mia.inc']) assert.equal(await readFile(join(root, 'build', 'include', name), 'utf8'), runtimeFiles[name]);
  assert.deepEqual(built.value.loadPlan.steps, [
    {kind: 'mia', path: 'build/asset-palette.bin', address: 0x100, length: 256},
    {kind: 'mia', path: 'build/asset-chr-3.bin', address: 0x4a00, length: 6144},
    {kind: 'prg', path: 'build/game.prg', loadAddress: 0x6000, length: 3, runAddress: 0x6000},
  ]);
  assert.equal(built.value.bootstrapSource, [
    '10 MIALOAD "build/asset-palette.bin",256',
    '20 MIALOAD "build/asset-chr-3.bin",18944',
    '30 BANK 0:BRUN "build/game.prg"', '',
  ].join('\n'));
  assert.deepEqual(Array.from(await readFile(join(root, 'build', 'game.prg'))), [0, 0x60, 0xa9, 0x2a, 0x60]);
  assert.deepEqual(Array.from((await readFile(join(root, 'build', 'asset-palette.bin'))).slice(0, 4)), [0, 0, 0x34, 0x12]);
  assert.equal((await readFile(join(root, 'build', 'asset-chr-3.bin')))[0], 0x80);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'build', 'load-plan.json'), 'utf8')), built.value.loadPlan);
  assert.equal(await readFile(join(root, 'build', 'bootstrap.bas'), 'utf8'), built.value.bootstrapSource);
});

test('BASIC project build compiles the entry source and emits a direct-launch load plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-basic-build-'));
  const source = '10 PRINT "HI"\n20 END\n';
  await writeFile(join(root, 'main.bas'), source);
  await writeFile(join(root, 'clementina.yaml'), [
    'format: clementina-project', 'version: 1', 'name: Basic Build Test',
    'target:', '  machine: clementina-6502',
    'program:', '  entry: main.bas',
    'assets:', '  palettes: []', '  paletteConfigs: []',
    '  tilesets: []', '  backgrounds: []', '  overlays: []', '  shapes: []', '  animations: []',
    'build:', '  outputDirectory: build', '  basic:', '    outputName: game', '',
  ].join('\n'));

  const built = await buildProject(root);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.equal(built.value.assembly, undefined);
  const expectedBytes = compileBasicProgram(source);
  assert.deepEqual(built.value.loadPlan.steps, [{kind: 'basic', path: 'build/game.bas', length: expectedBytes.length}]);
  assert.deepEqual(built.value.basic, {source: 'main.bas', artifact: 'build/game.bas', bytes: expectedBytes, lines: 2});
  assert.deepEqual(built.value.files.map(file => file.kind), ['basic', 'bootstrap', 'load-plan', 'memory-layout']);
  assert.equal(built.value.bootstrapSource, '10 LOAD "build/game.bas"\n');
  assert.deepEqual(Array.from(await readFile(join(root, 'build', 'game.bas'))), Array.from(expectedBytes));
  assert.deepEqual(JSON.parse(await readFile(join(root, 'build', 'load-plan.json'), 'utf8')), built.value.loadPlan);
});

test('project build configuration rejects duplicate banks and implicit banked CPU placement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-build-invalid-'));
  await writeFile(join(root, 'clementina.yaml'), [
    'format: clementina-project', 'version: 1', 'name: Invalid', 'target: {machine: clementina-6502}',
    'assets: {palettes: [], paletteConfigs: [], tilesets: [], backgrounds: [], overlays: [], shapes: [], animations: []}',
    'build:', '  outputDirectory: build', '  assembly:', '    sources: [main.s]', '    linkerConfig: game.cfg',
    '    outputName: game', '    loadAddress: 32768', '    entrySymbol: start',
    '  video:', '    tilesets:', '      - {tilesetId: tileset:a, bank: 1}', '      - {tilesetId: tileset:b, bank: 1}', '',
  ].join('\n'));
  const built = await buildProject(root, deterministicTools);
  assert.equal(built.ok, false);
  assert.ok(built.diagnostics.some(item => item.code === 'project.build.bank'));
  assert.ok(built.diagnostics.some(item => item.code === 'project.build.chr-bank'));
});

/** Write a BASIC entry plus one assembly part, linked at $6000 by deterministicTools. */
async function basicWithAssembly(basic) {
  const root = await mkdtemp(join(tmpdir(), 'clementina-basic-asm-build-'));
  await writeFile(join(root, 'main.bas'), '10 SYS 24576\n20 END\n');
  await writeFile(join(root, 'code.s'), '; code\n');
  await writeFile(join(root, 'link.cfg'), '# linker\n');
  await writeFile(join(root, 'clementina.yaml'), [
    'format: clementina-project', 'version: 1', 'name: Basic And Assembly',
    'target: {machine: clementina-6502}', 'program: {entry: main.bas}',
    'assets: {palettes: [], paletteConfigs: [], tilesets: [], backgrounds: [], overlays: [], shapes: [], animations: []}',
    'build:', '  outputDirectory: build', `  basic: ${JSON.stringify(basic)}`,
    '  assembly: {sources: [code.s], linkerConfig: link.cfg, outputName: code, loadAddress: 24576, entrySymbol: game_start}', '',
  ].join('\n'));
  return root;
}

test('a BASIC program with assembly BLOADs the PRG above a lowered MEMSIZ, then loads and runs the program', async () => {
  const root = await basicWithAssembly({outputName: 'game', memoryTop: 0x6000});
  const built = await buildProject(root, deterministicTools);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.equal(built.value.assembly.entryAddress, 0x6000);
  assert.equal(built.value.basic.artifact, 'build/game.bas');
  assert.deepEqual(built.value.loadPlan.steps, [
    {kind: 'memoryTop', address: 0x6000},
    {kind: 'prg', path: 'build/code.prg', loadAddress: 0x6000, length: 3},
    {kind: 'basic', path: 'build/game.bas', length: compileBasicProgram('10 SYS 24576\n20 END\n').length},
  ]);
  assert.equal(built.value.bootstrapSource, [
    '10 POKE 63,0:POKE 64,96:CLEAR', '20 BANK 0:BLOAD "build/code.prg"', '30 LOAD "build/game.bas"', '',
  ].join('\n'));
  // Above MEMSIZ the PRG is out of BASIC's way, so nothing overlaps.
  assert.deepEqual(built.diagnostics, []);
  const layout = JSON.parse(await readFile(join(root, 'build', 'memory-layout.json'), 'utf8'));
  assert.deepEqual(layout, built.value.memoryLayout);
  assert.deepEqual(layout.cpu.find(region => region.owner === 'basic'), {name: 'BASIC', owner: 'basic', bank: 0, start: 0x1600, size: 0x6000 - 0x1600,
    note: 'The interpreter, then the program, variables and strings up to MEMSIZ ($6000); where the interpreter ends moves with each ROM build'});
  assert.deepEqual(layout.cpu.find(region => region.owner === 'program'), {name: 'build/code.prg', owner: 'program', bank: 0, start: 0x6000, size: 3, file: 'build/code.prg'});
});

test('the layout warns, without failing, when assembly lands in the RAM a BASIC program uses', async () => {
  const root = await basicWithAssembly({outputName: 'game'});
  const built = await buildProject(root, deterministicTools);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.deepEqual(built.diagnostics.map(d => [d.severity, d.code, d.message]), [
    ['warning', 'build.layout.overlap', 'build/code.prg ($6000-$6002) overlaps BASIC ($1600-$BFFF)'],
  ]);
  assert.deepEqual(built.value.memoryLayout.diagnostics, built.diagnostics);
});

test('a BASIC entry needs build.basic, and build.basic needs a BASIC entry', async () => {
  const root = await basicWithAssembly({outputName: 'game'});
  const manifest = (await readFile(join(root, 'clementina.yaml'), 'utf8'));
  await writeFile(join(root, 'clementina.yaml'), manifest.replace(/  basic: .*\n/u, ''));
  let built = await buildProject(root, deterministicTools);
  assert.ok(built.diagnostics.some(d => d.code === 'project.build.basic' && d.path === '/build'));
  await writeFile(join(root, 'clementina.yaml'), manifest.replace('program: {entry: main.bas}\n', ''));
  built = await buildProject(root, deterministicTools);
  assert.ok(built.diagnostics.some(d => d.code === 'project.build.basic' && d.path === '/build/basic'));
});
