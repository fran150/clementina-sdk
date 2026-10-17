import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadSpecs, renderMiaInc} from '../scripts/generate-includes.mjs';
import {
  Report,
  cDefines,
  checkRomInclude,
  chrTiles,
  cEnums,
  cmakeDefault,
  cReturnFunctions,
  cString,
  evaluate,
  firstDifference,
  indexDefaults,
  jmpOperand,
  nameTable,
  paletteBanks,
  parseDbg,
  parseLbl,
} from '../scripts/check-drift.mjs';

test('drift check evaluates C macros the way the MIA headers use them', () => {
  const macros = new Map([...cDefines(`
#define BASE 0x12000u          // block start
#define SIZE (0x40u)
#define VOICES_OFFSET (BASE + SIZE)
#define VOICE_OFFSET(voice) (VOICES_OFFSET + (voice) * 16u)
#define FLAG (1u << 3)
#define LONG_LINE (BASE + \\
                   2u)
`), ...cEnums('typedef enum { MODE_A = 0, MODE_B, MODE_C = MODE_B + 4, MODE_D } mode_t;'),
    ...cReturnFunctions('static __force_inline uint32_t voice_base(uint8_t voice) {\n    return VOICE_OFFSET(voice);\n}')]);
  assert.equal(evaluate('VOICE_OFFSET(2)', macros), 0x12000 + 0x40 + 32);
  assert.equal(evaluate('voice_base(1) + 9u', macros), 0x12000 + 0x40 + 16 + 9);
  assert.equal(evaluate('(uint8_t)(FLAG | 1u)', macros), 9);
  assert.equal(evaluate('LONG_LINE', macros), 0x12002);
  assert.deepEqual(['MODE_A', 'MODE_B', 'MODE_C', 'MODE_D'].map(n => evaluate(n, macros)), [0, 1, 5, 6]);
  assert.equal(evaluate('BASE + i * 5u', macros, {i: 3}), 0x12000 + 15);
  assert.throws(() => evaluate('UNKNOWN + 1', macros), /unknown symbol UNKNOWN/);
  assert.throws(() => evaluate('BASE; process.exit()', macros), /cannot evaluate|unknown symbol/);
});

test('drift check reads index reset defaults from configure calls', () => {
  const source = `
static void demo_configure_index(uint8_t index_id, uint32_t start, uint32_t length, bool step) {
    idx[index_id].current_addr = start;
    idx[index_id].default_addr = start;
    idx[index_id].limit_addr = start + length;
    idx[index_id].step = 1u;
    idx[index_id].flags = (1u << IDX_FLAG_WRAP_ENA);
    if (step) {
        idx[index_id].flags |= (1u << IDX_FLAG_R_STP_ENA) | (1u << IDX_FLAG_W_STP_ENA);
    }
}
static void demo_configure_indexes(void) {
    demo_configure_index(DEMO_INDEX_STATE, DEMO_OFFSET, 32u, true);
    for (uint32_t i = 0; i < 8u; i++) {
        demo_configure_index((uint8_t)(DEMO_INDEX_RUN_0 + i), DEMO_OFFSET + i * 10u, 10u, true);
        demo_configure_index((uint8_t)(DEMO_INDEX_PROBE_0 + i), DEMO_OFFSET, 1u, false);
    }
}
void demo_set_probe(uint8_t probe_id, uint32_t offset) {
    demo_configure_index((uint8_t)(DEMO_INDEX_PROBE_0 + probe_id), DEMO_OFFSET + offset, 1u, false);
}`;
  const macros = cDefines('#define DEMO_INDEX_STATE 0x60u\n#define DEMO_INDEX_RUN_0 0x64u\n#define DEMO_INDEX_PROBE_0 0x50u\n#define DEMO_OFFSET 0x11000u\n#define IDX_FLAG_WRAP_ENA 3\n');
  const defaults = indexDefaults(source, macros);
  assert.deepEqual([...defaults.keys()].sort((a, b) => a - b), [0x50, 0x60, 0x64]);
  assert.deepEqual(defaults.get(0x60), {start: 0x11000, length: 32, step: 1, flags: ['R_STP_ENA', 'WRAP_ENA', 'W_STP_ENA'], shape: true});
  assert.equal(defaults.get(0x64).stride, 10);
  assert.equal(defaults.get(0x64).idStride, 1);
  assert.deepEqual(defaults.get(0x50).flags, ['WRAP_ENA']);
  assert.equal(defaults.get(0x50).stride, 0);
});

test('drift check reads ld65 symbols by module and decodes keyword tables', () => {
  const dbg = parseDbg([
    'version\tmajor=2,minor=0',
    'mod\tid=0,name="kernel.o",file=0',
    'mod\tid=1,name="basic.o",file=1',
    'scope\tid=0,name="",mod=0,size=1',
    'scope\tid=1,name="",mod=1,size=1',
    'seg\tid=0,name="KEYWORDS",start=0x001000,size=0x0008,addrsize=absolute,type=ro,oname="kernel.bin",ooffs=4',
    'sym\tid=0,name="KPTR",addrsize=zeropage,scope=0,def=1,val=0xF0,type=equ',
    'sym\tid=1,name="KPTR",addrsize=zeropage,scope=1,def=2,val=0xF0,type=equ',
    'sym\tid=2,name="TABLE",addrsize=absolute,scope=1,def=3,val=0x1000,seg=0,type=lab',
    'sym\tid=3,name="__KERNEL_START__",addrsize=absolute,scope=1,type=imp',
  ].join('\n'));
  assert.deepEqual(dbg.symbols.map(s => `${s.module}:${s.name}=${s.value}`), ['kernel:KPTR=240', 'basic:KPTR=240', 'basic:TABLE=4096']);
  const bin = Buffer.from([0, 0, 0, 0, 0x45, 0x4e, 0xc4, 0xd4 /* T|$80 */, 0x4f, 0xd2, 0, 0x99]);
  assert.deepEqual(nameTable(bin, dbg.segments, 0x1000), ['END', 'T', 'OR']);
  assert.deepEqual(nameTable(bin, dbg.segments, 0x1000, 0x1003), ['END']);
  assert.deepEqual([...parseLbl('al 000400 .__KERNEL_START__\nal 001200 .__KERNEL_SIZE__\n')], [['__KERNEL_START__', 0x400], ['__KERNEL_SIZE__', 0x1200]]);
  const text = Buffer.from([0, 0, 0, 0, 0x0d, 0x0a, 0x4f, 0x4b, 0, 0x41, 0x42, 0x43]);
  assert.equal(cString(text, dbg.segments, 0x1000), '\r\nOK');
  assert.throws(() => cString(text, dbg.segments, 0x1005), /no zero byte/);
  const jmp = Buffer.from([0x4c, 0x34, 0x12, 0x20, 0x34, 0x12]), jmpSegments = [{start: 0x0400, size: 6, offset: 0}];
  assert.equal(jmpOperand(jmp, jmpSegments, 0x0400), 0x1234);
  assert.throws(() => jmpOperand(jmp, jmpSegments, 0x0403), /not a JMP/);
  assert.throws(() => jmpOperand(jmp, jmpSegments, 0x0404), /no output segment/);
});

test('drift check reads CMake defaults, palette and charset files', () => {
  const cmake = '# set(MIA_PALETTE "old" CACHE STRING "")\nset(MIA_PALETTE "clementina-text" CACHE STRING "Default palette")\nset(PALETTE_BIN_FILE "x")\n';
  assert.equal(cmakeDefault(cmake, 'MIA_PALETTE'), 'clementina-text');
  assert.throws(() => cmakeDefault(cmake, 'PALETTE_BIN_FILE'), /no CACHE default/);
  assert.deepEqual(paletteBanks(Buffer.from([0x1f, 0x1a, 0xff, 0xff, 0x00, 0xf8, 0x00, 0x00]), 2), [[0x1a1f, 0xffff], [0xf800, 0]]);
  assert.throws(() => paletteBanks(Buffer.alloc(6), 2), /not whole banks/);
  const chr = {banks: 2, planes: 2, bytesPerBank: 8, planeBytes: 4, tilesPerBank: 2};
  assert.deepEqual(chrTiles(Buffer.from([1, 2, 3, 4, 0, 0, 0, 0, 0xff, 0, 0, 0, 0, 0, 0, 9]), chr), [[['0102', '0304'], ['0000', '0000']], [['ff00', '0000'], ['0000', '0009']]]);
  assert.throws(() => chrTiles(Buffer.alloc(15), chr), /not 2 banks of 8/);
});

test('drift report names the first value that differs', () => {
  assert.deepEqual(firstDifference(['A', 'B'], ['A', 'C']), ['[1]', 'B', 'C']);
  assert.deepEqual(firstDifference({start: 1, flags: ['X']}, {start: 1, flags: []}), ['.flags[0]', 'X', undefined]);
  assert.equal(firstDifference({a: 1}, {a: 1}), null);
  const report = new Report();
  report.same('audio.json', 'voices', 4, 4, 'audio.h');
  report.same('audio.json', 'sampleRateHz', 48000, 44100, 'MIA_AUDIO_SAMPLE_RATE');
  report.same('basic.json', 'tokens.primary', ['END', 'FOR'], ['END', 'FUR'], 'the ROM build');
  report.same('kernel-abi.json', 'KERN_PLOT', 0x42d, () => { throw Error('KERN_PLOT is not defined in kernel'); }, 'kernel.inc');
  assert.equal(report.checked, 4);
  assert.deepEqual(report.problems, [
    'audio.json: sampleRateHz is 48000 ($BB80) in the spec but 44100 ($AC44) in MIA_AUDIO_SAMPLE_RATE',
    'basic.json: tokens.primary[1] is "FOR" in the spec but "FUR" in the ROM build',
    'kernel-abi.json: KERN_PLOT is not defined in kernel (kernel.inc)',
  ]);
});

test('drift check requires the ROM copy of mia.inc to match the specs', () => {
  const specs = loadSpecs(), rom = mkdtempSync(join(tmpdir(), 'clementina-rom-'));
  const run = () => { const report = new Report(); checkRomInclude(report, specs, rom); return report.problems; };
  assert.match(run()[0], /src\/include\/mia\.inc: is missing/);
  mkdirSync(join(rom, 'src', 'include'), {recursive: true});
  writeFileSync(join(rom, 'src', 'include', 'mia.inc'), renderMiaInc(specs).replace('MIA_CTX ', 'MIA_CTX_OLD '));
  assert.match(run()[0], /differs from what the specs generate/);
  writeFileSync(join(rom, 'src', 'include', 'mia.inc'), renderMiaInc(specs));
  assert.deepEqual(run(), []);
});
