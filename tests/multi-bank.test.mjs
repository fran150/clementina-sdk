// Assembly code in several banks: build.assembly.banks, the bank-switch
// warning of the assembly language server, and the debugger's bank-switch stops.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildAssembly, createAssemblySourceMap, readLinkerMemory} from '../packages/assembler/dist/index.js';
import {buildProject} from '../packages/build/dist/index.js';
import {checkProjectManifest} from '../packages/project/dist/index.js';
import {AsmWorkspace, bankedSegments, configDiagnostics, parseConfig, workspaceBankWarnings} from '../packages/asm-lsp/dist/index.js';
import {bankSwitchStops} from '../packages/debug/dist/index.js';
import {libraryFiles} from '../packages/lib/dist/index.js';

const hasCc65 = spawnSync('ca65', ['--version'], {stdio: 'ignore'}).status === 0
  && spawnSync('ld65', ['--version'], {stdio: 'ignore'}).status === 0;
const example = new URL('../examples/multi-bank/', import.meta.url);

test('the linker configuration reader finds each area\'s file and bank', () => {
  const areas = readLinkerMemory(`# banks
MEMORY {
  MAIN: start = $7000, size = $1000, file = %O;
  BANK1: start = $8000 size = $4000 file = "%O.bank1" bank = 1;  # no commas
  B2: start = $8000, size = $4000, bank = $2, file = "b2.bin", define = yes;
  NONE: start = $9000, size = 16, file = "";
  ZP: start = $98, size = $48;
}
SEGMENTS { CODE: load = MAIN; }`, 'build/code.bin');
  assert.deepEqual([...areas.values()], [
    {name: 'MAIN', file: 'build/code.bin'},
    {name: 'BANK1', file: 'build/code.bin.bank1', bank: 1},
    {name: 'B2', bank: 2, file: 'b2.bin'},
    {name: 'NONE', file: ''},
    {name: 'ZP'},
  ]);
});

test('the manifest lists banks once each, and not the main image\'s bank', () => {
  const manifest = {
    format: 'clementina-project', version: 1, name: 'Banks', target: {machine: 'clementina-6502'},
    assets: {palettes: [], paletteConfigs: [], tilesets: [], backgrounds: [], overlays: [], shapes: [], animations: []},
    build: {outputDirectory: 'build', assembly: {
      sources: ['src/main.s'], linkerConfig: 'link.cfg', outputName: 'code', loadAddress: '$8000', bank: 1, entrySymbol: 'start',
      banks: [{bank: 1, memory: 'A'}, {bank: 2, memory: 'B'}, {bank: 3, memory: 'B'}],
    }},
  };
  const checked = checkProjectManifest(manifest);
  assert.deepEqual(checked.diagnostics.map(item => item.path), ['/build/assembly/banks/0/bank', '/build/assembly/banks/2/memory']);
  const schema = checkProjectManifest({...manifest, build: {...manifest.build, assembly: {...manifest.build.assembly, banks: [{bank: 32, memory: 'A'}]}}});
  assert.ok(schema.diagnostics.some(item => item.path === '/build/assembly/banks/0/bank'));
});

/** A project with main code at $7000 and a routine in bank 3. */
async function bankProject(config) {
  const root = await mkdtemp(join(tmpdir(), 'clementina-banks-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'main.s'), [
    '.setcpu "65C02"', '.import far', '.export start', '.segment "CODE"',
    'start: lda #<.bank(far)', '  sta $C001', '  jsr far', '  stz $C001', '  rts', '',
  ].join('\n'));
  await writeFile(join(root, 'src', 'far.s'), [
    '.setcpu "65C02"', '.export far', '.segment "FAR"', 'far: lda #3', '  sta $C001', '  rts', '',
  ].join('\n'));
  await writeFile(join(root, 'link.cfg'), config);
  return root;
}

const goodConfig = `MEMORY {
  MAIN: start = $7000, size = $1000, file = %O;
  BANK3: start = $8000, size = $4000, file = "%O.bank3", bank = 3;
}
SEGMENTS { CODE: load = MAIN, type = ro; FAR: load = BANK3, type = ro; }
`;
const request = {
  sources: ['src/main.s', 'src/far.s'], linkerConfig: 'link.cfg', outputDirectory: 'build', outputName: 'code',
  loadAddress: 0x7000, entrySymbol: 'start', banks: [{bank: 3, memory: 'BANK3'}],
};

test('each bank\'s MEMORY area becomes its own PRG with a BLOAD step in that bank', {skip: !hasCc65}, async () => {
  const root = await bankProject(goodConfig);
  const built = await buildAssembly(root, request);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.deepEqual(built.diagnostics, []);
  assert.equal(built.value.binary[1], 3, '.bank() reads the area\'s bank attribute');
  const [bank] = built.value.banks;
  assert.deepEqual(bank.loadStep, {kind: 'prg', path: 'build/code.bank3.prg', loadAddress: 0x8000, length: 6, bank: 3});
  assert.deepEqual(Array.from(bank.prg), [0x00, 0x80, 0xa9, 0x03, 0x8d, 0x01, 0xc0, 0x60]);
  assert.deepEqual(new Uint8Array(await readFile(join(root, 'build', 'code.bank3.prg'))), bank.prg);
  assert.deepEqual(built.value.segmentBanks, {FAR: 3});
  const sourceMap = createAssemblySourceMap(built.value.debug, {segmentBanks: built.value.segmentBanks});
  assert.deepEqual(sourceMap.locationsForSource('src/far.s', 4).map(location => [location.address, location.bank]), [[0x8000, 3]]);
  assert.deepEqual(sourceMap.locationsForSource('src/main.s', 5).map(location => [location.address, location.bank]), [[0x7000, undefined]]);
  // The store in bank 3 is a bank-switch stop; the ones in the main image are not.
  assert.deepEqual(bankSwitchStops(built.value), [{address: 0x8002, bank: 3}]);
});

test('a bank\'s area needs its own file, the right bank and to stay in $8000-$BFFF', {skip: !hasCc65}, async () => {
  const codes = async (config, extra = {}) => {
    const built = await buildAssembly(await bankProject(config), {...request, ...extra});
    return built.diagnostics.map(item => `${item.severity} ${item.code}`);
  };
  assert.deepEqual(await codes(goodConfig.replace('file = "%O.bank3", ', '')), ['error assembler.bank.file']);
  assert.deepEqual(await codes(goodConfig.replace('bank = 3', 'bank = 4')), ['error assembler.bank.attribute']);
  // ld65 itself fails a .bank() of an area without a bank attribute; without one, the build warns.
  const root = await bankProject(goodConfig.replace(', bank = 3', ''));
  await writeFile(join(root, 'src', 'main.s'), '.setcpu "65C02"\n.import far\n.export start\n.segment "CODE"\nstart: jsr far\n  rts\n');
  const unbanked = await buildAssembly(root, request);
  assert.deepEqual(unbanked.diagnostics.map(item => `${item.severity} ${item.code}`), ['warning assembler.bank.attribute']);
  assert.equal(unbanked.ok, true);
  assert.deepEqual(await codes(goodConfig, {banks: [{bank: 3, memory: 'BANK4'}]}), ['error assembler.bank.memory']);
  assert.deepEqual(await codes(goodConfig.replace('start = $8000', 'start = $BFFE')), ['error assembler.bank.bounds']);
  // Without build.assembly.banks, code in another file is still an error.
  assert.deepEqual(await codes(goodConfig, {banks: []}), ['error assembler.image.multiple-output']);
});

test('the multi-bank example loads each bank with BANK n:BLOAD before the shared code', {skip: !hasCc65}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-multi-bank-'));
  await cp(example, root, {recursive: true, filter: path => !path.includes('/build')});
  const built = await buildProject(root);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.deepEqual(built.diagnostics, []);
  assert.deepEqual(built.value.bootstrapSource.trim().split('\n'), [
    '10 REM MOVE BASIC MEMORY TOP',
    '20 POKE $3F,$00:POKE $40,$70:CLEAR',
    '30 BANK 1:BLOAD "CODE.BANK1.PRG"',
    '40 BANK 2:BLOAD "CODE.BANK2.PRG"',
    '50 BANK 0:BLOAD "CODE.PRG"',
    '60 RUN "ROOMS.BAS"',
  ]);
  for (const file of ['CODE.BANK1.PRG', 'CODE.BANK2.PRG', 'CODE.PRG', 'ROOMS.BAS', 'BOOT.BAS']) {
    await readFile(join(root, 'build', 'sd', file));
  }
  assert.deepEqual(built.value.memoryLayout.cpu.filter(region => region.owner === 'program').map(region => [region.name, region.bank, region.start]), [
    ['CODE.BANK1.PRG', 1, 0x8000], ['CODE.BANK2.PRG', 2, 0x8000], ['CODE.PRG', 0, 0x7000],
  ]);
  // The example switches banks only from the shared code.
  assert.deepEqual(bankSwitchStops(built.value.assembly), []);
});

test('the language server warns about stores to VIA Port A in banked code', () => {
  const config = parseConfig(readFileSync(new URL('link.cfg', example), 'utf8'));
  const segments = bankedSegments(config, [{bank: 1, memory: 'BANK1'}]);
  assert.deepEqual([...segments], [['BANK1', {memory: 'BANK1', bank: 1}], ['BANK2', {memory: 'BANK2', bank: 2}]]);
  assert.deepEqual(configDiagnostics(config, {returnsToBasic: true, linked: true, segments: [], memoryTop: 0x7000, loadAddress: 0x7000}), []);

  const workspace = new AsmWorkspace(() => ['/lib']);
  for (const [name, text] of Object.entries(libraryFiles)) workspace.set(`/lib/${name}`, text, true);
  workspace.set('/lib/clementina.inc', 'VIA_ORA = $C001\nVIA_ORA_NH = $C00F\n', true);
  workspace.set('/p/banked.s', `.include "clementina.inc"
.macro SelectBank n
        lda #n
        sta VIA_ORA
.endmacro
.segment "BANK1"
        lda #1
        sta VIA_ORA     ; maps bank 1 again: no warning
        lda #2
        sta VIA_ORA
        stz $C001
        stx VIA_ORA_NH
        sta $C011       ; a mirror
        sta VIA_ORA,x   ; indexed: not checked
        SelectBank 2
again:  sta VIA_ORA     ; a label: the lda before may not run
.segment "CODE"
        sta VIA_ORA     ; shared code may switch
`);
  const warnings = workspaceBankWarnings(workspace, '/p/banked.s', segments);
  assert.deepEqual(warnings.map(item => item.span.line), [9, 10, 11, 12, 14, 15]);
  assert.match(warnings[0].message, /bank 1 \(MEMORY area BANK1\)/u);
  assert.match(warnings[4].message, /^Macro SelectBank/u);

  for (const name of ['common.s', 'bank1.s', 'bank2.s']) {
    const path = `/example/${name}`;
    workspace.set(path, readFileSync(new URL(`src/${name}`, example), 'utf8'));
    assert.deepEqual(workspaceBankWarnings(workspace, path, segments), [], name);
  }
});
