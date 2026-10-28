// Measures the CPU cycle counts in docs/gamedev/performance.md.
// Usage, after npm run build: node scripts/measure-performance.mjs <clementina-automation>
// Each count is the cycles between two breakpoints, which stop before an opcode
// fetch, so a call's count includes its argument setup, the JSR and the RTS.
// Interrupts are masked except where the IRQ load itself is measured.
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {buildProject} from '../packages/build/dist/index.js';
import {startEmulatorProcess} from '../packages/emulator-client/dist/node.js';
import {basicRuntimeDebug} from '../packages/basic/dist/index.js';

const [executable] = process.argv.slice(2);
if (!executable) throw Error('Usage: node scripts/measure-performance.mjs <clementina-automation>');

async function stopped(client) {
  for (let n = 0; n < 20000; n++) {
    const state = await client.state();
    if (!state.running) return state;
    await new Promise(r => setTimeout(r, 2));
  }
  throw Error('The emulator did not stop');
}

// Kernel calls, index-window copies and the IRQ load, added to the runtime
// demo after its own calls. pm_<name>_b and pm_<name>_a bracket each one.
const extra = `
 clc
 ldx #24
 ldy #0
 jsr KERN_PLOT
 lda #'A'
pm_chrout_b: jsr KERN_CHROUT
pm_chrout_a:
 lda #13
pm_scroll_b: jsr KERN_CHROUT
pm_scroll_a:
 clc
 ldx #10
 ldy #0
 jsr KERN_PLOT
 lda #13
pm_return_b: jsr KERN_CHROUT
pm_return_a:
pm_getkey_b: jsr KERN_GETKEY_NB
pm_getkey_a:
pm_rdtim_b: jsr KERN_RDTIM
pm_rdtim_a:
pm_oam_b:
 lda #MIA_VIDEO_INDEX_OAM_SPRITE_0+1
 sta IDXB_SELECT
 .repeat 5, k
 lda pm_record+k
 sta IDXB_PORT
 .endrepeat
pm_oam_a:
 stz pm_addr
 lda #$40
 sta pm_addr+1
 lda #$01
 sta pm_addr+2
 ldx #pm_addr
 lda #(1 << IDX_FLAG_W_STP_ENA)
pm_seek_b: jsr rt_seek_a
pm_seek_a:
pm_write_b:
 ldx #0
@write: lda pm_buffer,x
 sta IDXA_PORT
 inx
 bne @write
pm_write_a:
pm_write8_b:
 ldx #0
@write8:
 .repeat 8, k
 lda pm_buffer+k,x
 sta IDXA_PORT
 .endrepeat
 txa
 clc
 adc #8
 tax
 bne @write8
pm_write8_a:
 ldx #pm_addr
 lda #(1 << IDX_FLAG_R_STP_ENA)
 jsr rt_seek_a
pm_read_b:
 ldx #0
@read: lda IDXA_PORT
 sta pm_buffer,x
 inx
 bne @read
pm_read_a:
pm_masked_b: jsr pm_delay
pm_masked_a:
 cli
pm_irqs_b: jsr pm_delay
pm_irqs_a:
 sei
pm_bank_row_b:
 DrawRow BG_LEVEL1, #0, #0, #40, #0, #0, #0
pm_bank_row_a:
pm_bank_column_b:
 DrawColumn BG_LEVEL1, #0, #0, #25, #0, #0, #0
pm_bank_column_a:
 Load BG_LEVEL1
pm_row_b:
 DrawRow BG_LEVEL1, #0, #0, #40, #0, #0, #0
pm_row_a:
pm_column_b:
 DrawColumn BG_LEVEL1, #0, #0, #25, #0, #0, #0
pm_column_a:
pm_cell_b:
 DrawRect BG_LEVEL1, #3, #3, #1, #1, #0, #3, #3
pm_cell_a:
pm_shape_b:
 DrawShape SPR_PLAYER, #SHAPE_PLAYER_IDLE, #4, #40, #40
pm_shape_a:
`;
const extraNames = [...extra.matchAll(/^pm_(\w+)_b:/gm)].map(m => m[1]);
const extraData = `.import rt_seek_a
.segment "ZEROPAGE"
pm_addr: .res 3
.segment "RODATA"
pm_record: .byte 0, 100, 80, 0, 0
.segment "BSS"
pm_buffer: .res 256
.segment "CODE"
; About 329,000 cycles.
pm_delay:
 ldx #0
 ldy #0
@delay: dey
 bne @delay
 dex
 bne @delay
 rts
`;

// The runtime demo with labels around every routine call, its player shape
// made of `sprites` sprites.
async function measureRuntime(sprites) {
  const root = await mkdtemp(join(tmpdir(), 'clementina-performance-'));
  await cp(new URL('../examples/runtime-demo/', import.meta.url), root, {recursive: true});
  const shapeFile = join(root, 'assets/shapes/0.json');
  const shape = JSON.parse(await readFile(shapeFile, 'utf8'));
  const one = shape.sprites[0];
  shape.sprites = Array.from({length: sprites}, (_, i) => ({...one, x: one.x + 8 * (i % 4), y: one.y - 8 * Math.floor(i / 4)}));
  await writeFile(shapeFile, JSON.stringify(shape));

  let source = await readFile(join(root, 'src/main.s'), 'utf8');
  source = source.replace(/ \.repeat (\d+)\n([\s\S]*?) \.endrepeat\n/g, (_, n, body) => body.repeat(Number(n)));
  const calls = [];
  let body = false;
  source = source.split('\n').flatMap(line => {
    if (line === 'cleared:') body = true;
    if (line === 'finished:') body = false;
    if (!body || !/^ [A-Z]\w*\b/.test(line) || line.startsWith(' Check')) return [line];
    calls.push(line.trim().replace(/\s*;.*$/, ''));
    return [`mb_${calls.length - 1}:`, line, `ma_${calls.length - 1}:`];
  }).join('\n');
  const edits = [
    ['game_start:\n cld\n', 'game_start:\n cld\n sei\n'],
    ['.include "assets.inc"\n', '.include "assets.inc"\n.include "clementina.inc"\n'],
    ['.segment "CODE"\n', extraData],
    [' lda #$A5\n sta $0282', extra + ' lda #$A5\n sta $0282'],
  ];
  for (const [needle, replacement] of edits) {
    assert.equal(source.split(needle).length, 2, `Expected one ${JSON.stringify(needle)}`);
    source = source.replace(needle, replacement);
  }
  await writeFile(join(root, 'src/main.s'), source);

  const built = await buildProject(root);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const symbols = new Map(built.value.assembly.debug.symbols.map(s => [s.name, s.value]));
  const address = name => {
    const value = symbols.get(name);
    assert.ok(Number.isInteger(value), `Missing ${name}`);
    return value;
  };
  const labels = [...calls.flatMap((_, i) => [`mb_${i}`, `ma_${i}`]), ...extraNames.flatMap(n => [`pm_${n}_b`, `pm_${n}_a`])];
  const hits = new Map();
  const emulator = await startEmulatorProcess({executable, sdRoot: resolve(root, built.value.sdRoot)});
  try {
    const c = emulator.client;
    // The program loads over BASIC, so its labels only mean the program once
    // it has started.
    await c.addBreakpoint(address('game_start'));
    await c.launchLoadPlan(built.value.loadPlan);
    assert.equal((await stopped(c)).pc, address('game_start'));
    await c.removeBreakpoint(address('game_start'));
    // ReadPad's figures are for connected gamepads.
    for (const player of [0, 1]) await c.setGamepadState(player, [0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const a of new Set([...labels, 'finished', 'failed'].map(address))) await c.addBreakpoint(a);
    for (;;) {
      await c.resume();
      const state = await stopped(c);
      if (state.pc === address('failed')) {
        const [check, error] = await c.readMemory(0x0280, 2);
        throw Error(`The demo failed after check ${check}, error ${error}`);
      }
      if (state.pc === address('finished')) break;
      if (!hits.has(state.pc)) hits.set(state.pc, Number(state.cycles));
    }
  } finally {
    await emulator.close();
  }
  const span = (from, to) => hits.get(address(to)) - hits.get(address(from));
  return {
    calls: calls.map((call, i) => [call, span(`mb_${i}`, `ma_${i}`)]),
    extra: Object.fromEntries(extraNames.map(n => [n, span(`pm_${n}_b`, `pm_${n}_a`)])),
  };
}

// BASIC statements, timed between the starts of consecutive statements
// (NEWSTT2). SYS 640 masks interrupts and SYS 642 unmasks them.
const program = [
  '10 FOR I=0 TO 3:READ B:POKE 640+I,B:NEXT',
  '20 DATA 120,96,88,96',
  '30 SYS 640',
  '40 A=1:B=3:C=7:A%=1:DIM D(10)',
  '100 A=A+1', '110 A%=A%+1', '120 A=A*B', '130 A=B/C', '140 POKE 700,1',
  '150 B=PEEK(700)', '160 D(3)=A', '170 IF A<0 THEN A=0', '180 GOSUB 900',
  '190 FOR I=1 TO 3:NEXT', '200 PRINT "A";', '210 A$="AB"', '220 X=SIN(A)',
  '230 X=INT(A/2)', '240 REM', '250 N=N+1:IF N<3 THEN 100',
  '260 SYS 642', '270 END', '900 RETURN',
];
async function measureBasic() {
  const root = await mkdtemp(join(tmpdir(), 'clementina-performance-basic-'));
  const emulator = await startEmulatorProcess({executable, sdRoot: root});
  const starts = [];
  try {
    const c = emulator.client;
    await c.reset();
    await c.step(4_000_000);
    for (const line of [...program, 'RUN']) {
      await c.input([...line].map(ch => ch.charCodeAt(0)).concat(13));
      if (line !== 'RUN') await c.step(400_000);
    }
    await c.addBreakpoint(basicRuntimeDebug.statementBoundaryAddress);
    await c.run();
    for (;;) {
      const state = await stopped(c);
      assert.equal(state.pc, basicRuntimeDebug.statementBoundaryAddress);
      const [low, high] = await c.readMemory(0x41, 2); // CURLIN
      starts.push([low | high << 8, Number(state.cycles)]);
      if ((low | high << 8) === 270) break;
      await c.resume();
    }
  } finally {
    await emulator.close();
  }
  // The second pass through lines 100-250 (its IF jumps back), each
  // statement with its cost.
  const first = starts.findIndex(([line], i) => line === 100 && starts.slice(0, i).some(([l]) => l === 100));
  const text = new Map(program.map(l => [Number(l.split(' ')[0]), l.slice(l.indexOf(' ') + 1).split(':')]));
  const result = [];
  let previous = null, part = 0;
  for (let i = first; i < starts.length - 1; i++) {
    const line = starts[i][0];
    if (i > first && line === 100) break;
    part = line === previous ? Math.min(part + 1, text.get(line).length - 1) : 0;
    previous = line;
    result.push([`${line} ${text.get(line)[part]}`, starts[i + 1][1] - starts[i][1]]);
  }
  return result;
}

const one = await measureRuntime(1);
const four = await measureRuntime(4);
const basic = await measureBasic();
// A count that grows with the shape: its fixed part and what each sprite adds.
const bySprites = (a, b) => a === b ? String(a) : `${a - Math.round((b - a) / 3)} + ${Math.round((b - a) / 3)} per sprite`;
const print = (title, rows) => {
  console.log(`\n${title}`);
  for (const [name, value] of rows) console.log(`${value.padStart(24)}  ${name}`);
};
print('Runtime demo calls', one.calls.map(([call, n], i) => [call, bySprites(n, four.calls[i][1])]));
print('Kernel calls, index windows, drawing', Object.entries(one.extra).map(([name, n]) => [name, name === 'shape' ? bySprites(n, four.extra[name]) : String(n)]));
const irqs = one.extra.irqs - one.extra.masked;
console.log(`\nIRQ load: ${irqs} cycles in ${one.extra.irqs}, ${(100 * irqs / one.extra.irqs).toFixed(2)}%`);
print('BASIC statements', basic.map(([statement, n]) => [statement, String(n)]));
