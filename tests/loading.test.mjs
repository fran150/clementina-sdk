import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASIC_STYLE_RAW_TILE,
  basicRuntimeDebug,
  basicSourceLineLength,
  basicStyleFlags,
  basicTokenTables,
  BasicProgramError,
  checkBootstrapSource,
  checkLoadPlan,
  checkLoadPlanLaunch,
  compileBasicProgram,
  detokenizeBasicProgram,
  encodePrg,
  inspectBasicProgram,
  inspectPrg,
  parseBasicSource,
  renderBootstrapSource,
  renderLoadPlanLaunch,
  tokenizeBasicLine,
  tokenizeBasicLineWithSpans,
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
    '10 MIALOAD "ASSETS/PALETTE.BIN",256',
    '20 BANK 1:BLOAD "BANK1.PRG"',
    '30 BANK 0:BRUN "GAME.PRG"',
    '',
  ].join('\n'));
});

test('load plans pick each PRG bank with BANK only when it changes', () => {
  const banked = {format: 'clementina-load-plan', version: 1, steps: [
    {kind: 'prg', path: 'A.PRG', loadAddress: 0x8000, bank: 2, length: 16},
    {kind: 'prg', path: 'B.PRG', loadAddress: 0xa000, bank: 2, length: 16},
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x8000, bank: 3, length: 64, runAddress: 0x8010},
  ]};
  assert.equal(renderBootstrapSource(banked), [
    '10 BANK 2:BLOAD "A.PRG"',
    '20 BLOAD "B.PRG"',
    '30 BANK 3:BRUN "GAME.PRG",32784',
    '',
  ].join('\n'));
  const basic = renderLoadPlanLaunch({format: 'clementina-load-plan', version: 1, steps: [
    {kind: 'mia', path: 'MAP.BIN', address: 0x14000, length: 16},
    {kind: 'prg', path: 'DATA.PRG', loadAddress: 0x8000, bank: 4, length: 16},
    {kind: 'basic', path: 'GAME.BAS', length: 2},
  ]});
  assert.deepEqual(basic.lines, ['MIALOAD "MAP.BIN",81920', 'BANK 4:BLOAD "DATA.PRG"', 'BANK 0:LOAD "GAME.BAS"']);
  assert.deepEqual(renderLoadPlanLaunch({format: 'clementina-load-plan', version: 1, steps: [
    {kind: 'basic', path: 'GAME.BAS', length: 2},
  ]}).lines, ['LOAD "GAME.BAS"']);
});

test('load plans enforce terminal takeover and warn about risky destinations', () => {
  const warns = (value, code) => {
    const checked = checkLoadPlan(value);
    assert.equal(checked.ok, true);
    assert.ok(checked.diagnostics.some(d => d.code === code && d.severity === 'warning'));
  };
  const overlap = {format: 'clementina-load-plan', version: 1, steps: [
    {kind: 'mia', path: 'TRACK.BIN', address: 0x13000, length: 16},
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x6000, length: 1, runAddress: 0x6000},
  ]};
  warns(overlap, 'load.mia.reserved');
  assert.deepEqual(checkLoadPlan({...overlap, steps: [
    {kind: 'mia', path: 'TRACK.BIN', address: 0x14000, length: 16}, overlap.steps[1],
  ]}).diagnostics, []);
  warns({...plan, steps: [{kind: 'prg', path: 'LOW.PRG', loadAddress: 0x2000, length: 1}, plan.steps[2]]}, 'load.prg.return');
  warns({...plan, steps: [{kind: 'prg', path: 'TOP.PRG', loadAddress: 0xb000, bank: 0, length: 1}, plan.steps[2]]}, 'load.prg.return');
  assert.deepEqual(checkLoadPlan({...plan, steps: [
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x8000, bank: 0, length: 1, runAddress: 0x8000},
  ]}).diagnostics, []);
  for (const changed of [
    {...plan, steps: plan.steps.slice(0, 2)},
    {...plan, steps: [plan.steps[2], plan.steps[0]]},
    {...plan, steps: [{kind: 'mia', path: '../BAD.BIN', address: 0, length: 1}, plan.steps[2]]},
    {...plan, steps: [{kind: 'mia', path: 'TOO-LARGE.BIN', address: 0x3ffff, length: 2}, plan.steps[2]]},
  ]) assert.equal(checkLoadPlan(changed).ok, false);
  assert.equal(checkBootstrapSource({...plan, steps: [
    {kind: 'mia', path: `${'A'.repeat(60)}.BIN`, address: 256, length: 1}, plan.steps[2],
  ]}).ok, false);
});

test('BASIC launch commands share the editor limit with numbered bootstraps', () => {
  const directPlan = {format: 'clementina-load-plan', version: 1, steps: [
    {kind: 'mia', path: 'A'.repeat(66), address: 256, length: 1},
    {kind: 'basic', path: 'GAME.BAS', length: 2},
  ]};
  const launch = renderLoadPlanLaunch(directPlan);
  assert.deepEqual(launch, {
    mode: 'direct',
    lines: [`MIALOAD "${'A'.repeat(66)}",256`, 'LOAD "GAME.BAS"'],
    startCommand: 'RUN',
  });
  assert.equal(launch.lines[0].length, 80);
  // Numbered, the same command gains a line number and no longer fits.
  assert.equal(checkBootstrapSource(directPlan).diagnostics.some(d => d.code === 'load.basic.line'), true);
  assert.equal(checkLoadPlanLaunch({...directPlan, steps: [
    {...directPlan.steps[0], path: 'A'.repeat(67)}, directPlan.steps[1],
  ]}).diagnostics.some(d => d.code === 'load.basic.line'), true);
  assert.equal(checkBootstrapSource({...plan, steps: [
    {...directPlan.steps[0], path: 'A'.repeat(64)}, plan.steps[2],
  ]}).diagnostics.some(d => d.code === 'load.basic.line'), true);
});

test('PRG helpers write and read the 2-byte header, whatever the bank', () => {
  const payload = Uint8Array.of(0xa9, 42, 0x60);
  const plain = encodePrg(payload, 0x6000);
  assert.deepEqual(Array.from(plain), [0x00, 0x60, ...payload]);
  assert.deepEqual(inspectPrg(plain), {loadAddress: 0x6000, headerLength: 2, payloadLength: 3});
  const banked = encodePrg(payload, 0x8000, 7);
  assert.deepEqual(Array.from(banked), [0x00, 0x80, ...payload]);
  assert.deepEqual(inspectPrg(banked), {loadAddress: 0x8000, headerLength: 2, payloadLength: 3});
  assert.deepEqual(inspectPrg(Uint8Array.of(0, 0xb0, 0, 1)), {loadAddress: 0xb000, headerLength: 2, payloadLength: 2});
  // The bank only bounds the size: from bank 31, one 16 KiB bank is left.
  assert.throws(() => encodePrg(new Uint8Array(0x4001), 0x8000, 31), /bank 31/);
  assert.equal(encodePrg(new Uint8Array(0x4000), 0x8000, 31).length, 0x4002);
  assert.throws(() => encodePrg(payload, 0xc000), /49151/);
  assert.throws(() => encodePrg(payload, 0x8000, 32), /bank|<= 31/i);
  assert.throws(() => encodePrg(new Uint8Array(0), 0x6000), /non-empty/);
});

test('BASIC token tables stay synchronized with the developer spec', async () => {
  const spec=JSON.parse(await readFile(new URL('../specs/basic.json',import.meta.url),'utf8'));
  assert.deepEqual(basicTokenTables.primary,spec.tokens.primary);
  assert.deepEqual(basicTokenTables.extension,spec.tokens.extension);
  assert.deepEqual(basicTokenTables.extension2,spec.tokens.extension2);
  assert.deepEqual(basicTokenTables.extensionFunction,spec.tokens.extensionFunction);
  assert.equal(basicTokenTables.mon,spec.tokens.special.MON);
  assert.equal(basicRuntimeDebug.statementBoundaryAddress,spec.runtimeDebug.statementBoundaryAddress);
  assert.equal(basicRuntimeDebug.currentLineAddress,spec.runtimeDebug.currentLineAddress);
  assert.equal(basicRuntimeDebug.variableTablePointerAddress,spec.runtimeDebug.variableTablePointerAddress);
  assert.equal(basicRuntimeDebug.directModeLine,spec.runtimeDebug.directModeLine);
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

test('BASIC tokenizer keeps the hex digits after a $ as typed', () => {
  const hex = text => Array.from(Buffer.from(text));
  // CD (an extension2 keyword) and DEF (primary) stay digits inside a hex number.
  assert.deepEqual(Array.from(tokenizeBasicLine('print $cd00;$1DEF0')), [0x9d, 0x20, ...hex('$CD00'), 0x3b, ...hex('$1DEF0')]);
  // A $ right after a letter or digit ends a string variable name: CD after it is a keyword again.
  assert.deepEqual(Array.from(tokenizeBasicLine('a$="x":b1$cd')), [...hex('A$'), 0xb2, ...hex('"x":B1$'), 0xfc, 0x93]);
  assert.deepEqual(Array.from(tokenizeBasicLine('$cdx')), [...hex('$CD'), 0x58]);
  assert.deepEqual(Array.from(tokenizeBasicLine('bank 2:brun "G"')), [0xff, 0xab, 0x20, 0x32, 0x3a, 0xff, 0xac, 0x20, ...hex('"G"')]);
  const {lexemes} = tokenizeBasicLineWithSpans('poke $CD00,1');
  assert.deepEqual(lexemes.filter(lexeme => lexeme.kind === 'keyword').map(lexeme => lexeme.keyword), ['POKE']);
});

test('token spans preserve source positions across keyword tables and raw modes', () => {
  const source = 'inputmode 1:input A:data go:rem print';
  const {bytes, lexemes} = tokenizeBasicLineWithSpans(source);
  assert.deepEqual(bytes, tokenizeBasicLine(source));
  assert.deepEqual(lexemes.filter(lexeme => lexeme.kind === 'keyword').map(lexeme => [lexeme.keyword, source.slice(lexeme.start, lexeme.end)]), [
    ['INPUTMODE', 'inputmode'], ['INPUT', 'input'], ['DATA', 'data'], ['REM', 'rem'],
  ]);
  assert.equal(lexemes.filter(lexeme => lexeme.kind === 'data').map(lexeme => source.slice(lexeme.start, lexeme.end)).join(''), 'go:');
  assert.equal(lexemes.filter(lexeme => lexeme.kind === 'remark').map(lexeme => source.slice(lexeme.start, lexeme.end)).join(''), ' print');
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
  for(const source of ['PRINT 1','64000 PRINT 1',`10 ${'A'.repeat(78)}`,'10 PRINT "é"']) {
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
  assert.equal(detokenizeBasicProgram(styled),'10 PRINT"{c5}A"\n');
  const invalid=styled.slice();invalid[13]=1;
  assert.throws(()=>inspectBasicProgram(invalid),/quoted literal/);
  // A record must cover its whole string, not bytes that merely sit between quotes.
  const between=Uint8Array.of(0xff,0xff,10,0,0x9d,0x22,0x41,0x22,0x3b,0x22,0x42,0x22,0,0xce,0xff,7,1,4,1,0,0,0);
  assert.throws(()=>inspectBasicProgram(between),/quoted literal/);
  // The editor never sets the raw-tile bit on a printable character, and source notation cannot say it.
  const raw=styled.slice();raw[15]=5|BASIC_STYLE_RAW_TILE;
  assert.throws(()=>detokenizeBasicProgram(raw),/line 10: .*raw-tile rule/);
});

test('BASIC source notation compiles glyph and style tags into stored bytes and sidecars', () => {
  const source = '10 PRINT "{c2 fy}F{c3}r{c4}a{c5}n"\n20 PRINT "{$81}{$0D} BOX";"{c1 rev}H{$91}"\n';
  const file = compileBasicProgram(source);
  const [first, second] = inspectBasicProgram(file).lines;
  assert.deepEqual(first.styles, [{literalOffset: 3, attributes: [0x22, 0x03, 0x04, 0x05]}]);
  assert.deepEqual(Array.from(file.slice(first.offset + 4 + first.tokens.length, second.offset)), [0, 0xce, 0xff, 10, 1, 3, 4, 0x22, 3, 4, 5]);
  // An unstyled string stores its glyph bytes with no record; a styled one marks glyphs with the raw-tile bit.
  assert.deepEqual(second.tokens, [0x9d, 0x20, 0x22, 0x81, 0x0d, 0x20, ...Buffer.from('BOX'), 0x22, 0x3b, 0x22, 0x48, 0x91, 0x22]);
  assert.deepEqual(second.styles, [{literalOffset: 12, attributes: [0x81, 0xc1]}]);
  assert.equal(detokenizeBasicProgram(file), source);
  // Canonical form: a styled string opens with its tag, printable tags become characters, { stays a tag.
  assert.equal(detokenizeBasicProgram(compileBasicProgram('10 ?"ab{FY C3}x{$41}{$7B}{c3 fy}y{c0}"\n')), '10 PRINT"{c0}ab{c3 fy}xA{$7B}y"\n');
  // A string left open at the end of the line keeps its record, as the ROM's tokenizer does.
  const open = compileBasicProgram('10 PRINT "{c7}OPEN\n');
  assert.deepEqual(inspectBasicProgram(open).lines[0].styles, [{literalOffset: 3, attributes: [7, 7, 7, 7]}]);
  assert.equal(detokenizeBasicProgram(open), '10 PRINT "{c7}OPEN\n');
});

test('BASIC source notation follows the ROM tokenizer in DATA and REM', () => {
  // A quote starts a string before DATA is checked, so its colon does not end DATA.
  assert.deepEqual(Array.from(tokenizeBasicLine('data "a:print",b')), [0x83, 0x20, 0x22, ...Buffer.from('a:print'), 0x22, 0x2c, 0x62]);
  assert.equal(detokenizeBasicProgram(compileBasicProgram('10 DATA "A:PRINT",B:PRINT\n')), '10 DATA "A:PRINT",B:PRINT\n');
  // A character tag is the byte typed, so {$3A} ends DATA like a colon.
  assert.deepEqual(Array.from(tokenizeBasicLine('data {$3A}print')), [0x83, 0x20, 0x3a, 0x9d]);
  assert.deepEqual(Array.from(tokenizeBasicLine('rem {$91}{$7B}')), [0x8e, 0x20, 0x91, 0x7b]);
  assert.equal(detokenizeBasicProgram(compileBasicProgram('10 REM {$91}{$7B}"\n20 DATA {$81},"{c1}X"\n')), '10 REM {$91}{$7B}"\n20 DATA {$81},"{c1}X"\n');
  // Outside strings, DATA and REM a brace is an ordinary character.
  assert.deepEqual(Array.from(tokenizeBasicLine('x{')), [0x58, 0x7b]);
});

test('BASIC source limits count typed characters and the ROM sidecar size', () => {
  const styled = `10 ?"${'{c1}A'.repeat(18)}"`;
  assert.ok(styled.length > 80);
  assert.equal(basicSourceLineLength(styled), 24);
  assert.doesNotThrow(() => compileBasicProgram(styled));
  assert.doesNotThrow(() => compileBasicProgram(`10 REM ${'{$41}'.repeat(73)}`));
  assert.throws(() => compileBasicProgram(`10 REM ${'{$41}'.repeat(74)}`), /80-character input limit/);
  // A sidecar holds 4 bytes plus 2 and one per character for each styled string, at most 42.
  assert.doesNotThrow(() => compileBasicProgram(`10 ?"{c1}${'A'.repeat(36)}"`));
  assert.throws(() => compileBasicProgram(`10 ?"{c1}${'A'.repeat(37)}"`), /need 43 style bytes .* at most 42/);
  assert.throws(() => compileBasicProgram(`10 ?"{c1}${'A'.repeat(18)}";"{c2}${'B'.repeat(17)}"`), /need 43 style bytes/);
});

test('BASIC source notation rejects malformed tags with their source columns', () => {
  // Columns are zero-based in the physical line, from the { to the end of the tag or line.
  const cases = [
    ['10 PRINT "{c16}"', /c0\.\.c15/, 10, 15],
    ['10 PRINT "{$00}"', /\$00 ends a tokenized line/, 10, 15],
    ['10 PRINT "{$22}"', /quote character/, 10, 15],
    ['10 PRINT "{c2 c3}"', /one color/, 10, 17],
    ['10 PRINT "{fx fx}"', /repeated style word 'fx'/, 10, 17],
    ['10 PRINT "{zz}"', /unknown style word 'zz'/, 10, 14],
    ['10 PRINT "{}"', /empty \{\} tag/, 10, 12],
    ['10 PRINT "{$8}"', /two hex digits/, 10, 14],
    ['10 PRINT "{c2 $81}"', /not both/, 10, 18],
    ['10 REM {c2}', /only apply inside quoted strings/, 7, 11],
    ['10 DATA {c2}', /only apply inside quoted strings/, 8, 12],
    ['10 PRINT "{c2', /unterminated/, 10, 13],
    ['10 PRINT "{c2"', /unterminated/, 10, 13],
  ];
  for (const [source, message, start, end] of cases) {
    assert.throws(() => parseBasicSource(source), error => {
      assert.ok(error instanceof BasicProgramError);
      assert.match(error.message, message);
      assert.equal(error.sourceLine, 1);
      assert.deepEqual(error.columns, {start, end}, source);
      return true;
    });
  }
  assert.throws(() => parseBasicSource('10 PRINT "é"'), error => error.sourceLine === 1 && error.columns.start === 10);
});

test('BASIC source notation words and sidecar facts match specs/basic.json', async () => {
  const spec = JSON.parse(await readFile(new URL('../specs/basic.json', import.meta.url), 'utf8'));
  const words = spec.sourceNotation.styleTag.words;
  assert.deepEqual(basicStyleFlags.map(flag => [flag.word, flag.bit]), words.filter(word => 'bit' in word).map(word => [word.word, 1 << word.bit]));
  assert.equal(BASIC_STYLE_RAW_TILE, spec.savedProgram.styleSidecar.rawTileBit);
  const file = compileBasicProgram(`10 ?"{c1}${'A'.repeat(36)}"\n`);
  const sidecar = 4 + inspectBasicProgram(file).lines[0].tokens.length + 1;
  assert.deepEqual(Array.from(file.slice(sidecar, sidecar + 2)), spec.savedProgram.styleSidecar.magic);
  assert.equal(file[sidecar + 2], spec.savedProgram.styleSidecar.maxBytes);
});

test('compiler and inspector reject the same invalid absolute base address', () => {
  const image = compileBasicProgram('10 END\n');
  for (const baseAddress of [0xff, 0xc000, 256.5, Number.NaN]) {
    assert.throws(() => compileBasicProgram('10 END\n', {baseAddress}), /baseAddress/);
    assert.throws(() => inspectBasicProgram(image, {baseAddress}), /baseAddress/);
  }
});

test('a memoryTop step lowers MEMSIZ and clears the warning for a PRG wholly above it', () => {
  const steps = [
    {kind: 'prg', path: 'CODE.PRG', loadAddress: 0xa000, length: 0x1000},
    {kind: 'basic', path: 'GAME.BAS', length: 2},
  ];
  const warned = plan => checkLoadPlan(plan).diagnostics.some(d => d.code === 'load.prg.return');
  const base = {format: 'clementina-load-plan', version: 1};
  assert.equal(warned({...base, steps}), true);
  assert.equal(warned({...base, steps: [{kind: 'memoryTop', address: 0xa000}, ...steps]}), false);
  // One byte below the lowered top is still BASIC's.
  assert.equal(warned({...base, steps: [{kind: 'memoryTop', address: 0xa001}, ...steps]}), true);
  assert.deepEqual(renderLoadPlanLaunch({...base, steps: [{kind: 'memoryTop', address: 0xa000}, ...steps]}).lines, [
    'POKE 63,0:POKE 64,160:CLEAR', 'BANK 0:BLOAD "CODE.PRG"', 'LOAD "GAME.BAS"',
  ]);
  assert.equal(checkLoadPlan({...base, steps: [{kind: 'memoryTop', address: 0xa000}, {kind: 'memoryTop', address: 0xa000}, ...steps]}).ok, false);
  assert.equal(checkLoadPlan({...base, steps: [{kind: 'memoryTop', address: 0x1000}, ...steps]}).ok, false);
});
