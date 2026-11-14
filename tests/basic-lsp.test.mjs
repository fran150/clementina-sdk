import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {
  analyzeDiagnostics,
  analyzeStrings,
  backdropColor,
  basicKeywordByName,
  cellColors,
  basicKeywordEntries,
  completionsFor,
  completionsAt,
  definitionAt,
  documentSymbols,
  formatBasicSource,
  glyphKeyFor,
  hoverAt,
  basicSignatureByKeyword,
  previewScreen,
  referencesAt,
  renameAt,
  renderCellsSvg,
  renderScreenSvg,
  renumberBasicSource,
  restyleStrings,
  rgb565ToCss,
  semanticSpans,
  signatureHelpAt,
  stringHoverAt,
  tagCompletionsAt,
} from '../packages/basic-lsp/dist/index.js';
import {basicTokenTables, tokenizeBasicLine, tokenizeBasicLineWithSpans} from '../packages/basic/dist/index.js';

const hex = n => `$${n.toString(16).toUpperCase().padStart(2, '0')}`;

test('analyzeDiagnostics reports every bad line in one pass, not just the first', () => {
  const diagnostics = analyzeDiagnostics('BADLINE1\n10 PRINT "OK"\nBADLINE2\n99999999 END\n');
  assert.deepEqual(diagnostics.map(d => d.line), [1, 3, 4]);
  assert.ok(diagnostics.every(d => d.code === 'basic.parse'));
  assert.match(diagnostics[0].message, /expected a numbered BASIC line/);
  assert.match(diagnostics[2].message, /line number must be 0\.\.63999/);
});

test('analyzeDiagnostics returns nothing for a valid program', () => {
  assert.deepEqual(analyzeDiagnostics('10 PRINT "HI"\n20 END\n'), []);
});

test('source analysis uses physical CRLF positions and effective line deletion', () => {
  const source = '10 GOTO 30\r\n30 END\r\n30 PRINT 1\r\n30\r\n40 END\r\n';
  assert.deepEqual(analyzeDiagnostics(source).filter(item => item.code === 'basic.target').map(item => item.line), [1]);
  assert.equal(definitionAt(source, 1, 9), undefined);
  assert.deepEqual(documentSymbols(source).filter(symbol => symbol.kind === 'line').map(symbol => [symbol.name, symbol.line]),
    [['10', 1], ['40', 5]]);
  assert.equal(semanticSpans(source).some(span => span.line === 2 || span.line === 3 || span.line === 4), false);
});

test('target diagnostics follow ROM lexical modes and cover direct, implicit, and ON branch targets', () => {
  const source = [
    '10 GOTO 100',
    '20 IF X THEN 200',
    '30 ON X GOSUB 100,300',
    '40 GO TO 400',
    '50 RUN 500',
    '60 PRINT "GOTO 600":DATA GOTO 700',
    '70 REM GOSUB 800',
    '100 END',
  ].join('\n');
  const diagnostics = analyzeDiagnostics(source).filter(item => item.code === 'basic.target');
  assert.deepEqual(diagnostics.map(item => [item.line, item.message]), [
    [2, 'THEN target line 200 does not exist'],
    [3, 'GOSUB target line 300 does not exist'],
    [4, 'GO TO target line 400 does not exist'],
    [5, 'RUN target line 500 does not exist'],
  ]);
  assert.deepEqual(source.split('\n')[1].slice(diagnostics[0].startCharacter, diagnostics[0].endCharacter), '200');
});

test('definitionAt resolves effective numbered lines and ignores ordinary numbers', () => {
  const source = '100 END\n10 GOTO 100\n100 PRINT "LAST"\n20 X=100\n';
  assert.deepEqual(definitionAt(source, 2, 9), {line: 3, startCharacter: 0, endCharacter: 3});
  assert.equal(definitionAt(source, 4, 5), undefined);
  assert.equal(definitionAt('10 GOTO 99\n', 1, 9), undefined);
});

test('signatureHelpAt reports canonical function signatures and nested active parameters', () => {
  assert.deepEqual(signatureHelpAt('10 X=PADBTN(0,1)', 1, 14), {
    label: 'PADBTN(pad, button)', parameters: ['pad', 'button'], activeParameter: 1,
  });
  assert.deepEqual(signatureHelpAt('10 X=LEFT$("ABC",MID$("12",1,1))', 1, 30), {
    label: 'MID$(string, start[, length])', parameters: ['string', 'start', 'length?'], activeParameter: 2,
  });
  assert.equal(signatureHelpAt('10 PRINT "PADBTN(0,1)"', 1, 20), undefined);
  assert.deepEqual(signatureHelpAt('10 SPRITE 0,1,2,3,4,5', 1, 18), {
    label: 'SPRITE index,tile,x,y,palette,flags',
    parameters: ['index', 'tile', 'x', 'y', 'palette', 'flags'],
    activeParameter: 4,
  });
  assert.deepEqual(signatureHelpAt('10 X=FNA(1)', 1, 10), {
    label: 'FNname(argument)', parameters: ['argument'], activeParameter: 0,
  });
});

test('keyword entries are the ones in specs/basic.json and drive the signatures', async () => {
  const spec = JSON.parse(await readFile(new URL('../specs/basic.json', import.meta.url), 'utf8'));
  assert.deepEqual(basicKeywordEntries, spec.keywords.entries);
  for (const [keyword, signature] of basicSignatureByKeyword) assert.equal(signature.label, basicKeywordByName.get(keyword).syntax);
  assert.deepEqual(basicSignatureByKeyword.get('BLOAD').parameters, ['path', 'address?']);
  assert.deepEqual(basicSignatureByKeyword.get('NEXT').parameters, ['variable...?']);
  assert.equal(basicSignatureByKeyword.has('TO'), false);
});

test('signature catalog covers every Clementina extension token', () => {
  for (const keyword of [...basicTokenTables.extension, ...basicTokenTables.extension2, ...basicTokenTables.extensionFunction]) {
    assert.ok(basicSignatureByKeyword.has(keyword), `missing signature for ${keyword}`);
  }
});

test('syntax diagnostics validate parenthesis structure and known function arity', () => {
  const diagnostics = analyzeDiagnostics('10 X=PADBTN(0)\n20 Y=(1+2))\n');
  assert.deepEqual(diagnostics.filter(item => item.code === 'basic.syntax').map(item => item.message), [
    'PADBTN expects 2 argument(s), found 1',
    'Unmatched closing parenthesis',
  ]);
  assert.equal(analyzeDiagnostics('10 PRINT "PADBTN(0) ("\n').filter(item => item.code === 'basic.syntax').length, 0);
});

test('function signatures and arity share opening-parenthesis handling for FN and suffixed tokens', () => {
  const source = '10 X=FNA(1,2):Y=TAB(4,5)';
  assert.deepEqual(analyzeDiagnostics(source).filter(item => item.code === 'basic.syntax').map(item => item.message), [
    'FN expects 1 argument(s), found 2',
    'TAB expects 1 argument(s), found 2',
  ]);
  assert.equal(signatureHelpAt(source, 1, source.indexOf('1,2') + 2)?.label, 'FNname(argument)');
  assert.equal(signatureHelpAt(source, 1, source.indexOf('4,5') + 2)?.label, 'TAB(column)');
});

test('references, rename, symbols, contextual completion, and semantic spans share tokenizer locations', () => {
  const source = '10 ZX=1:GOTO 30\n20 ZX=ZX+1\n30 PRINT ZX\n';
  assert.equal(referencesAt(source, 1, 4).length, 4);
  assert.deepEqual(renameAt(source, 2, 4, 'Q').map(edit => [edit.line, edit.newText]), [[1, 'Q'], [2, 'Q'], [2, 'Q'], [3, 'Q']]);
  assert.throws(() => renameAt(source, 1, 4, 'SCORE'), /contains a BASIC keyword/);
  assert.deepEqual(renameAt(source, 1, 13, '100').map(edit => [edit.line, edit.newText]), [[3, '100'], [1, '100']]);
  assert.ok(documentSymbols(source).some(symbol => symbol.kind === 'variable' && symbol.name === 'ZX'));
  assert.ok(completionsAt(source, 2, 6).some(item => item.category === 'variable' && item.keyword === 'ZX'));
  assert.deepEqual(completionsAt('10 SP', 1, 5).map(item => item.keyword),
    ['SPRBANK', 'SPRCOLOR', 'SPRCOUNT', 'SPRFLIP', 'SPRITE', 'SPROFF', 'SPRON', 'SPRPRI', 'SPRTILE', 'SPRX', 'SPRY']);
  const types = new Set(semanticSpans('10 ZX=PADBTN(0,1):REM hi\n').map(span => span.type));
  assert.deepEqual([...types].sort(), ['comment', 'keyword', 'number', 'operator', 'variable']);
});

test('variable references follow BASIC two-character name significance', () => {
  const source = '10 APPLE=1\n20 APPLICATION=APPLE+1\n';
  assert.equal(referencesAt(source, 1, 4).length, 3);
  assert.deepEqual(renameAt(source, 1, 4, 'AX').map(edit => edit.newText), ['AX', 'AX', 'AX']);
  assert.equal(documentSymbols(source).filter(symbol => symbol.kind === 'variable').length, 1);
});

test('formatBasicSource uses the ROM tokenizer and canonical LIST representation', () => {
  assert.equal(formatBasicSource('20 ? "Keep Case"\n10 x=cue(0)\n'), '10 X=CUE(0)\n20 PRINT "Keep Case"\n');
});
test('formatBasicSource keeps valid shorthand when LIST expansion exceeds the input limit', () => {
  const input = `10 ${'?:'.repeat(14)}?\n`;
  const output = formatBasicSource(input);
  assert.equal(output, input);
  assert.deepEqual(analyzeDiagnostics(output), []);
  const atLimit = `10${'?:'.repeat(38)}?1\n`;
  assert.equal(formatBasicSource(atLimit), atLimit);
  assert.deepEqual(analyzeDiagnostics(formatBasicSource(atLimit)), []);
});

test('renumberBasicSource updates static targets while preserving literals, DATA, REM, and undefined targets', () => {
  const source = [
    '100 GOTO 300',
    '200 ON X GOSUB 100,999',
    '300 IF X THEN 100:PRINT "GOTO 300":DATA GOTO 300',
    '400 REM GOTO 100',
  ].join('\n');
  assert.equal(renumberBasicSource(source, {start: 1000, step: 5}), [
    '1000 GOTO 1010',
    '1005 ON X GOSUB 1000,999',
    '1010 IF X THEN 1000:PRINT "GOTO 300":DATA GOTO 300',
    '1015 REM GOTO 100',
    '',
  ].join('\n'));
  assert.throws(() => renumberBasicSource('10 END', {start: 64000}), /exceeds 63999/);
});

test('tokenizeBasicLineWithSpans exposes the canonical tokenizer decisions', () => {
  const detailed = tokenizeBasicLineWithSpans('X=GOTO100:REM GOTO 200');
  assert.deepEqual(detailed.bytes, tokenizeBasicLine('X=GOTO100:REM GOTO 200'));
  assert.deepEqual(detailed.lexemes.filter(item => item.keyword).map(item => [item.keyword, item.start, item.end]), [
    ['=', 1, 2], ['GOTO', 2, 6], ['REM', 10, 13],
  ]);
});

test('analyzeDiagnostics recovers line attribution for a non-ASCII line instead of throwing', () => {
  const diagnostics = analyzeDiagnostics('10 PRINT "OK"\n20 PRINT "café"\n');
  assert.deepEqual(diagnostics.map(d => d.line), [2]);
  assert.match(diagnostics[0].message, /printable 7-bit ASCII/);
});

test('hoverAt resolves every keyword category using the canonical token tables, preferring an exact suffix match', () => {
  const primaryIndex = basicTokenTables.primary.indexOf('PRINT');
  assert.deepEqual(hoverAt('10 PRINT "HI"', 1, 4),
    {keyword: 'PRINT', category: 'primary', token: hex(basicTokenTables.primaryStart + primaryIndex)});

  const cueIndex = basicTokenTables.extensionFunction.indexOf('CUE');
  assert.deepEqual(hoverAt('10 X=CUE(0)', 1, 6), {
    keyword: 'CUE', category: 'extensionFunction',
    token: `${hex(basicTokenTables.extensionFunctionPrefix)},${hex(basicTokenTables.extensionSubtokenStart + cueIndex)}`,
  });

  const trackIndex = basicTokenTables.extension2.indexOf('TRACK');
  assert.deepEqual(hoverAt('10 TRACK 0,S$', 1, 5), {
    keyword: 'TRACK', category: 'extension2',
    token: `${hex(basicTokenTables.extension2Prefix)},${hex(basicTokenTables.extensionSubtokenStart + trackIndex)}`,
  });

  const sndonIndex = basicTokenTables.extension.indexOf('SNDON');
  assert.deepEqual(hoverAt('10 SNDON', 1, 5), {
    keyword: 'SNDON', category: 'extension',
    token: `${hex(basicTokenTables.extensionPrefix)},${hex(basicTokenTables.extensionSubtokenStart + sndonIndex)}`,
  });

  // "CUE(" is not itself a table entry; hover must fall back to the bare "CUE" rather than matching nothing.
  const strIndex = basicTokenTables.primary.indexOf('STR$');
  assert.deepEqual(hoverAt('10 X=STR$(5)', 1, 6), {keyword: 'STR$', category: 'primary', token: hex(basicTokenTables.primaryStart + strIndex)});
  const tabIndex = basicTokenTables.primary.indexOf('TAB(');
  assert.deepEqual(hoverAt('10 PRINT TAB(5)', 1, 10), {keyword: 'TAB(', category: 'primary', token: hex(basicTokenTables.primaryStart + tabIndex)});

  assert.deepEqual(hoverAt('MON', 1, 1), {keyword: 'MON', category: 'special', token: hex(basicTokenTables.mon)});
  assert.equal(hoverAt('10 X=FOOBAR', 1, 6), undefined);
  assert.equal(hoverAt('10 REM nothing here', 1, 100), undefined);
});

test('completionsFor filters by prefix and covers every table exactly once', () => {
  assert.deepEqual(completionsFor('TR').map(item => item.keyword), ['TRACK']);
  const all = completionsFor('');
  const expectedCount = basicTokenTables.primary.length + basicTokenTables.extension.length
    + basicTokenTables.extension2.length + basicTokenTables.extensionFunction.length + 1;
  assert.equal(all.length, expectedCount);
  assert.equal(new Set(all.map(item => item.keyword)).size, expectedCount);
  assert.ok(all.every(item => item.keyword.startsWith('')));
  assert.deepEqual([...new Set(all.map(item => item.category))].sort(),
    ['extension', 'extension2', 'extensionFunction', 'primary', 'special']);
});

test('string analysis reports styled cells, tags, and quoted DATA items', () => {
  const source = '10 PRINT "{c2 fy}F{c3}r";"{$81}X"\n20 DATA "{c1}A",{$82}:REM {$83}\n';
  const {strings, tags} = analyzeStrings(source);
  assert.deepEqual(strings.map(string => [string.line, source.split('\n')[string.line - 1].slice(string.startCharacter, string.endCharacter), string.styled, string.data]), [
    [1, '{c2 fy}F{c3}r', true, false], [1, '{$81}X', false, false], [2, '{c1}A', true, true],
  ]);
  assert.deepEqual(strings[0].cells.map(cell => [cell.code, cell.attribute]), [[0x46, 0x22], [0x72, 0x03]]);
  // An unstyled string's cells have no attribute: they print at the BASIC pen.
  assert.deepEqual(strings[1].cells.map(cell => [cell.code, cell.attribute, cell.tagged]), [[0x81, undefined, true], [0x58, undefined, false]]);
  assert.deepEqual(tags.map(tag => [tag.line, tag.kind, tag.code ?? tag.attribute]), [
    [1, 'style', 0x22], [1, 'style', 3], [1, 'character', 0x81], [2, 'style', 1], [2, 'character', 0x82], [2, 'character', 0x83],
  ]);
});

test('string hover describes tags and the characters a style tag covers', () => {
  const source = '10 PRINT "{c2 fy}FR{c3}A";"{$0D}"\n';
  const style = stringHoverAt(source, 1, 12);
  assert.equal(style.kind, 'style');
  assert.equal(style.attribute, 0x22);
  assert.deepEqual(style.styled.map(cell => cell.code), [0x46, 0x52]);
  const glyph = stringHoverAt(source, 1, 29);
  assert.equal(glyph.kind, 'character');
  assert.equal(glyph.code, 0x0d);
  assert.equal(glyph.string.styled, false);
  assert.equal(stringHoverAt(source, 1, 18).kind, 'string');
  assert.equal(stringHoverAt('10 PRINT "PLAIN"\n', 1, 12), undefined);
});

test('tag completion offers glyph codes and, in quoted strings, the style words', () => {
  const all = tagCompletionsAt('10 ?"{', 1, 6);
  assert.equal(all.filter(item => item.kind === 'character').length, 254);
  assert.ok(!all.some(item => item.code === 0 || item.code === 0x22));
  assert.deepEqual(all.filter(item => item.kind !== 'character').map(item => item.label),
    [...Array.from({length: 16}, (_, bank) => `c${bank}`), 'fx', 'fy', 'rev']);
  assert.deepEqual(tagCompletionsAt('10 ?"{c1 f', 1, 10).map(item => item.label), ['fx', 'fy', 'rev']);
  // A character completion closes the tag unless a } already follows.
  const typed = tagCompletionsAt('10 ?"{$8', 1, 8).find(item => item.code === 0x81);
  assert.deepEqual([typed.newText, typed.startCharacter, typed.endCharacter], ['$81}', 6, 8]);
  assert.equal(tagCompletionsAt('10 ?"{$8}"', 1, 8).find(item => item.code === 0x81).newText, '$81');
  assert.ok(tagCompletionsAt('10 REM {', 1, 8).every(item => item.kind === 'character'));
  assert.equal(tagCompletionsAt('10 X={', 1, 6), undefined);
  assert.equal(tagCompletionsAt('10 ?"{c1}A', 1, 10), undefined);
});

test('restyling rewrites whole strings canonically', () => {
  const source = '10 PRINT "{c2 fy}F{c3}r{c4}a";"AB"\n';
  const select = (start, end) => [{start: {line: 1, character: start}, end: {line: 1, character: end}}];
  assert.deepEqual(restyleStrings(source, select(17, 18), 0x87).map(edit => edit.newText), ['{c7 rev}F{c3}r{c4}a']);
  // Styling part of an unstyled string gives the rest color 0, since a string is styled whole.
  assert.deepEqual(restyleStrings(source, select(32, 33), 0x05), [{line: 1, startCharacter: 31, endCharacter: 33, newText: '{c0}A{c5}B'}]);
  // An empty selection is the string it is in; null removes every style.
  assert.deepEqual(restyleStrings(source, select(20, 20), null).map(edit => edit.newText), ['Fra']);
  assert.deepEqual(restyleStrings(source, select(3, 8), 1), []);
});

test('string diagnostics, semantic spans and transforms keep tags', () => {
  const diagnostics = analyzeDiagnostics('10 PRINT "{$0D}{$81}";"{c0}{$0D}"\n20 DATA "{$0D}"\n30 PRINT "{c9"\n');
  assert.deepEqual(diagnostics.map(item => [item.line, item.code, item.severity, item.startCharacter, item.endCharacter]), [
    [1, 'basic.glyph', 'warning', 10, 15], [3, 'basic.parse', undefined, 10, 13],
  ]);
  assert.match(diagnostics[0].message, /does "newline"/);
  const spans = semanticSpans('10 PRINT "A{c1}B"\n').filter(span => span.type === 'string').map(span => [span.startCharacter, span.endCharacter]);
  assert.ok(!spans.some(([start]) => start >= 11 && start < 15));
  assert.equal(formatBasicSource('20 ? "{FY c2}x"\n10 rem {$91}\n'), '10 REM {$91}\n20 PRINT "{c2 fy}x"\n');
  assert.equal(renumberBasicSource('5 ?"{c1}A":GOTO 5\n', {start: 10, step: 10}), '10 ?"{c1}A":GOTO 10\n');
  // Formatting measures typed characters, so tags do not push a line over the input limit.
  const long = `10 ?"${'{c1}A{c2}B'.repeat(8)}"\n`;
  assert.equal(formatBasicSource(long), long.replace('?', 'PRINT'));
});

test('glyph rendering draws the default charset, palette, flips and reverse', () => {
  assert.equal(rgb565ToCss(0xffff), '#ffffff');
  assert.equal(rgb565ToCss(0xf800), '#ff0000');
  assert.deepEqual(cellColors(0x01), {ink: '#ff0000', background: '#1941ff'});
  assert.deepEqual(cellColors(0x81), {ink: '#1941ff', background: '#ff0000'});
  assert.deepEqual(glyphKeyFor(0x41), {mode: 0, key: 'A'});
  assert.deepEqual(glyphKeyFor(0x81), {mode: 1, key: '!'});
  assert.deepEqual(glyphKeyFor(0x00), {mode: 2, key: '@'});
  assert.equal(glyphKeyFor(0x7f), undefined);
  assert.equal(glyphKeyFor(0xdf), undefined);
  // L: a stem on the left and a foot on the bottom row, mirrored by the flips.
  const ink = svg => /<path fill="#ffffff" d="([^"]*)"/u.exec(svg)[1];
  assert.match(ink(renderCellsSvg([{code: 0x4c, attribute: 0}])), /^M1 0h2v1h-2z.*M1 6h6v1h-6z$/u);
  assert.match(ink(renderCellsSvg([{code: 0x4c, attribute: 0x30}])), /^M1 1h6v1h-6z.*M5 7h2v1h-2z$/u);
  assert.match(renderCellsSvg([{code: 0x41, attribute: 0}, {code: 0x42, attribute: 0}], 10), /width="20" height="10" viewBox="0 0 16 8"/u);
});

/** A preview's rows as text, without trailing spaces. */
const screenText = preview => preview.rows.map(row => String.fromCharCode(...row.map(cell => cell.code)).trimEnd());

test('screen preview lays PRINT out as the ROM does: zones, TAB, SPC, number spacing and line ends', () => {
  const preview = previewScreen('10 PRINT 5;-3,"X";TAB(20);"Y";SPC(2);"Z"\n20 PRINT "A";\n30 PRINT "B":PRINT\n40 ?"C"\n', [4, 1, 2, 3, 2]);
  assert.deepEqual(preview.lines, [10, 20, 30, 40]);
  assert.deepEqual(screenText(preview), [' 5 -3         X     Y  Z', 'AB', '', 'C']);
  assert.deepEqual([preview.placeholders, preview.notes, preview.backdrop], [[], [], undefined]);
});

test('screen preview shows run-time values as placeholders and keeps every value of a PRINT', () => {
  const preview = previewScreen('100 PRINT "{rev c0}Great! You found my number in ";C%;"attempts"\n', [1]);
  assert.deepEqual(screenText(preview), ['Great! You found my number in  C% attemp', 'ts']);
  assert.deepEqual(preview.placeholders, [{row: 0, startColumn: 31, endColumn: 33}]);
  assert.deepEqual([preview.rows[0][0].attribute, preview.rows[0][31].attribute, preview.rows[0][31].placeholder, preview.rows[1][0].attribute], [0x80, 0, 1, 0]);
  // Values written next to each other print one after another, and a comparison is a number.
  const juxtaposed = previewScreen('10 PRINT A$"B"C$;LEFT$(A$,2);X=1\n', [1]);
  assert.deepEqual(screenText(juxtaposed), ['A$BC$LEFT$(A$,2) X=1']);
  assert.deepEqual(juxtaposed.placeholders.map(run => [run.startColumn, run.endColumn]), [[0, 2], [3, 5], [5, 16], [17, 20]]);
});

test('screen preview applies the BASIC pen, STYLE and BCOLOR', () => {
  const preview = previewScreen('10 COLOR 2:FLIPX 1\n20 PRINT "A";"{c5}B";1\n30 STYLE 1:PRINT "{c5 fy}C"\n40 ALT 1:COLOR 3:FLIPX 0:PRINT "D"\n50 BCOLOR 9\n', [1, 2, 3, 4, 5]);
  assert.deepEqual(screenText(preview), ['AB 1', 'C', 'D']);
  assert.deepEqual(preview.rows[0].slice(0, 5).map(cell => cell.attribute), [0x12, 0x05, 0x12, 0x12, 0x00]);
  assert.deepEqual([preview.rows[1][0].attribute, preview.rows[2][0].attribute, preview.backdrop], [0x22, 0x83, 9]);
});

test('screen preview runs control codes in unstyled strings and draws them as glyphs in styled ones', () => {
  const plain = previewScreen('10 PRINT "AB{$08}C{$0D}D{$91}E"\n', [1]);
  assert.deepEqual(screenText(plain), ['AE', 'D']);
  const styled = previewScreen('10 PRINT "{c1}{$0D}{$91}"\n', [1]);
  assert.deepEqual(styled.rows[0].slice(0, 2), [{code: 0x0d, attribute: 1}, {code: 0x91, attribute: 1}]);
});

test('screen preview clears, moves the cursor, wraps and scrolls', () => {
  const moved = previewScreen('10 PRINT "A":CLS:CRSR 38,2:PRINT "XYZ"\n', [1]);
  assert.deepEqual(screenText(moved), ['', '', `${' '.repeat(38)}XY`, 'Z']);
  const scrolled = previewScreen(Array.from({length: 26}, (_, index) => `${index + 1} PRINT "L${index + 1}"`).join('\n'), Array.from({length: 26}, (_, index) => index + 1));
  assert.equal(scrolled.rows.length, 24);
  assert.deepEqual([screenText(scrolled)[0], screenText(scrolled)[23]], ['L3', 'L26']);
  assert.deepEqual(previewScreen('10 PRINT "A":CLS\n', [1]).rows, []);
});

test('screen preview follows THEN, skips REM, DATA and invalid lines, and notes what it cannot run', () => {
  const preview = previewScreen('10 IF X THEN PRINT "Y":GOTO 10\n20 REM PRINT "N"\n30 DATA "A:B":PRINT "Z"\nBAD\n40\n50 COLOR X:CRSR 45,1:PRINT TAB(N);"Q"\n', [1, 2, 3, 4, 5, 6, 99]);
  assert.deepEqual(preview.lines, [10, 20, 30, 50]);
  assert.deepEqual(screenText(preview), ['Y', 'Z', 'Q']);
  assert.deepEqual(preview.notes.map(note => [note.line, note.number]), [[6, 50], [6, 50], [6, 50]]);
  assert.match(preview.notes[0].message, /^COLOR X is only known when the program runs, so the BASIC pen keeps its color\.$/u);
  assert.match(preview.notes[1].message, /^CRSR 45,1 is out of range/u);
  assert.match(preview.notes[2].message, /^TAB\(N\) is only known when the program runs/u);
});

test('screen rendering paints the backdrop once and outlines placeholders', () => {
  assert.equal(backdropColor(), '#1941ff');
  assert.equal(backdropColor(0), '#ffffff');
  assert.deepEqual(cellColors(0x81, '#000000'), {ink: '#000000', background: '#ff0000'});
  const svg = renderScreenSvg(previewScreen('10 BCOLOR 0:PRINT A\n', [1]));
  assert.match(svg, /^<svg [^>]*width="320" height="8" viewBox="0 0 320 8"[^>]*><rect width="320" height="8" fill="#ffffff"\/>/u);
  assert.match(svg, /stroke="#000000"[^>]*><rect x="8.25" y="0.25" width="7.5" height="7.5"\/><\/g><\/svg>$/u);
  assert.doesNotMatch(svg, /<path fill="#ffffff" d="M0 0h8v8h-8z/u);
});

async function exerciseStdioServer(binPath) {
  const child = spawn(process.execPath, [binPath], {stdio: ['pipe', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const messages = [];
  let buffer = Buffer.alloc(0);
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'));
      if (!match) return;
      const length = Number(match[1]), bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      messages.push(JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString('utf8')));
      buffer = buffer.subarray(bodyStart + length);
    }
  });

  const send = message => {
    const json = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  };
  let nextId = 1;
  const request = (method, params) => { const id = nextId++; send({jsonrpc: '2.0', id, method, params}); return id; };
  const notify = (method, params) => send({jsonrpc: '2.0', method, params});
  const waitFor = async (predicate, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for an LSP message. stderr: ${stderr}`);
  };

  try {
    const initId = request('initialize', {processId: null, rootUri: null, capabilities: {}});
    const initialized = await waitFor(m => m.id === initId);
    assert.equal(initialized.result.capabilities.hoverProvider, true);
    assert.equal(initialized.result.capabilities.definitionProvider, true);
    assert.equal(initialized.result.capabilities.referencesProvider, true);
    assert.equal(initialized.result.capabilities.renameProvider.prepareProvider, true);
    assert.equal(initialized.result.capabilities.documentSymbolProvider, true);
    assert.equal(initialized.result.capabilities.semanticTokensProvider.full, true);
    assert.equal(initialized.result.capabilities.documentFormattingProvider, true);
    notify('initialized', {});
    notify('textDocument/didOpen', {
      textDocument: {uri: 'file:///test.bas', languageId: 'basic', version: 1, text: 'BADLINE\n10 PRINT "OK"\n'},
    });
    const published = await waitFor(m => m.method === 'textDocument/publishDiagnostics');
    assert.equal(published.params.uri, 'file:///test.bas');
    assert.equal(published.params.diagnostics.length, 1);
    assert.deepEqual(published.params.diagnostics[0].range, {start: {line: 0, character: 0}, end: {line: 0, character: 7}});
    assert.match(published.params.diagnostics[0].message, /expected a numbered BASIC line/);

    const hoverId = request('textDocument/hover', {textDocument: {uri: 'file:///test.bas'}, position: {line: 1, character: 4}});
    const hover = await waitFor(m => m.id === hoverId);
    assert.match(hover.result.contents.value, /\*\*PRINT\*\*/);
    assert.ok(hover.result.contents.value.includes(basicKeywordByName.get('PRINT').summary));

    const completionId = request('textDocument/completion', {textDocument: {uri: 'file:///test.bas'}, position: {line: 1, character: 6}});
    const completion = await waitFor(m => m.id === completionId);
    assert.deepEqual(completion.result.map(item => item.label), ['PRINT']);

    notify('textDocument/didChange', {
      textDocument: {uri: 'file:///test.bas', version: 2},
      contentChanges: [{text: '10 x=padbtn(0,1):goto 30\n30 end\n'}],
    });
    const definitionId = request('textDocument/definition', {textDocument: {uri: 'file:///test.bas'}, position: {line: 0, character: 22}});
    const definition = await waitFor(m => m.id === definitionId);
    assert.deepEqual(definition.result.range, {start: {line: 1, character: 0}, end: {line: 1, character: 2}});

    const signatureId = request('textDocument/signatureHelp', {textDocument: {uri: 'file:///test.bas'}, position: {line: 0, character: 14}});
    const signature = await waitFor(m => m.id === signatureId);
    assert.equal(signature.result.signatures[0].label, 'PADBTN(pad, button)');
    assert.deepEqual(signature.result.signatures[0].parameters, [{label: [7, 10]}, {label: [12, 18]}]);
    assert.equal(signature.result.activeParameter, 1);

    const referencesId = request('textDocument/references', {
      textDocument: {uri: 'file:///test.bas'}, position: {line: 0, character: 3}, context: {includeDeclaration: true},
    });
    const references = await waitFor(m => m.id === referencesId);
    assert.equal(references.result.length, 1);

    const symbolsId = request('textDocument/documentSymbol', {textDocument: {uri: 'file:///test.bas'}});
    const symbols = await waitFor(m => m.id === symbolsId);
    assert.ok(symbols.result.some(symbol => symbol.name === 'X'));

    const semanticId = request('textDocument/semanticTokens/full', {textDocument: {uri: 'file:///test.bas'}});
    const semantic = await waitFor(m => m.id === semanticId);
    assert.ok(semantic.result.data.length > 0);

    const formatId = request('textDocument/formatting', {textDocument: {uri: 'file:///test.bas'}, options: {tabSize: 2, insertSpaces: true}});
    const formatting = await waitFor(m => m.id === formatId);
    assert.equal(formatting.result[0].newText, '10 X=PADBTN(0,1):GOTO 30\n30 END\n');

    const actionId = request('textDocument/codeAction', {
      textDocument: {uri: 'file:///test.bas'},
      range: {start: {line: 0, character: 0}, end: {line: 1, character: 6}},
      context: {diagnostics: []},
    });
    const actions = await waitFor(m => m.id === actionId);
    assert.equal(actions.result[0].command.command, 'clementina.basic.renumber');

    const renumberId = request('workspace/executeCommand', {
      command: 'clementina.basic.renumber', arguments: ['file:///test.bas', 100, 100],
    });
    const applyEdit = await waitFor(m => m.method === 'workspace/applyEdit');
    assert.equal(applyEdit.params.edit.changes['file:///test.bas'][0].newText,
      '100 x=padbtn(0,1):goto 200\n200 end\n');
    send({jsonrpc: '2.0', id: applyEdit.id, result: {applied: true}});
    const renumbered = await waitFor(m => m.id === renumberId);
    assert.equal(renumbered.result, true);

    const overflowId = request('workspace/executeCommand', {
      command: 'clementina.basic.renumber', arguments: ['file:///test.bas', 63995, 10],
    });
    const failure = await waitFor(m => m.method === 'window/showMessageRequest');
    assert.equal(failure.params.type, 1);
    assert.match(failure.params.message, /^Cannot renumber BASIC program: .*exceeds 63999/);
    send({jsonrpc: '2.0', id: failure.id, result: null});
    assert.equal((await waitFor(m => m.id === overflowId)).result, false);

    assert.deepEqual(initialized.result.capabilities.completionProvider, {triggerCharacters: ['{', '$', ' '], resolveProvider: true});
    notify('textDocument/didChange', {
      textDocument: {uri: 'file:///test.bas', version: 3},
      contentChanges: [{text: '10 PRINT "{c2 fy}F{c3}r";"{$81}"\n20 PRINT "{\n'}],
    });
    const tagsId = request('clementina/basicTags', {textDocument: {uri: 'file:///test.bas'}});
    const tags = (await waitFor(m => m.id === tagsId)).result;
    assert.deepEqual(tags[0], {start: {line: 0, character: 10}, end: {line: 0, character: 17}});
    assert.equal(tags.length, 3);
    // A selection ending at the start of a line leaves that line out; line 20 does not parse.
    const screenId = request('clementina/basicScreen', {
      textDocument: {uri: 'file:///test.bas'},
      ranges: [{start: {line: 0, character: 3}, end: {line: 1, character: 0}}, {start: {line: 1, character: 2}, end: {line: 1, character: 2}}],
    });
    const screen = (await waitFor(m => m.id === screenId)).result;
    assert.deepEqual([screen.lines, screen.rows, screen.placeholders, screen.notes], [[10], 1, false, []]);
    assert.match(Buffer.from(screen.image.split(',')[1], 'base64').toString(), /^<svg [^>]*width="320" height="8"/u);
    const noScreenId = request('clementina/basicScreen', {textDocument: {uri: 'file:///test.bas'}, ranges: 'all'});
    assert.deepEqual((await waitFor(m => m.id === noScreenId)).result, {lines: [], placeholders: false, notes: []});

    const glyphsId = request('clementina/basicGlyphs', {cellSize: 16});
    const glyphs = (await waitFor(m => m.id === glyphsId)).result;
    assert.equal(glyphs.length, 254);
    assert.deepEqual([glyphs[0x80].label, glyphs[0x80].description], ['$82', 'glyph mode 1, key "']);
    const stylesId = request('clementina/basicStyles', {});
    const styles = (await waitFor(m => m.id === stylesId)).result;
    assert.deepEqual([styles.colors.length, styles.colors[2].name, styles.flags.map(flag => flag.word)], [16, 'orange', ['fx', 'fy', 'rev']]);

    const tagCompletionId = request('textDocument/completion', {
      textDocument: {uri: 'file:///test.bas'}, position: {line: 1, character: 11}, context: {triggerKind: 2, triggerCharacter: '{'},
    });
    const tagCompletion = (await waitFor(m => m.id === tagCompletionId)).result;
    const color = tagCompletion.find(item => item.label === 'c2');
    // Kind 16 is Color, whose documentation an editor shows as a swatch.
    assert.deepEqual([color.kind, color.documentation, color.textEdit.newText], [16, '#ff8e00', 'c2']);
    const glyph = tagCompletion.find(item => item.label === '$81');
    assert.equal(glyph.textEdit.newText, '$81}');
    const resolveId = request('completionItem/resolve', glyph);
    const resolved = (await waitFor(m => m.id === resolveId)).result;
    assert.match(resolved.documentation.value, /^\*\*Tile \$81\*\* — glyph mode 1, key `!`\n\n!\[tile \$81\]\(data:image\/svg\+xml;base64,/u);
    const spaceId = request('textDocument/completion', {
      textDocument: {uri: 'file:///test.bas'}, position: {line: 0, character: 8}, context: {triggerKind: 2, triggerCharacter: ' '},
    });
    assert.deepEqual((await waitFor(m => m.id === spaceId)).result, []);

    const tagHoverId = request('textDocument/hover', {textDocument: {uri: 'file:///test.bas'}, position: {line: 0, character: 12}});
    assert.match((await waitFor(m => m.id === tagHoverId)).result.contents.value, /^\*\*\{c2 fy\}\*\* — color 2 \(orange\), flip Y\n\n!\[styled characters\]/u);

    const styleId = request('workspace/executeCommand', {
      command: 'clementina.basic.styleStrings',
      arguments: ['file:///test.bas', [{start: {line: 0, character: 17}, end: {line: 0, character: 17}}], 0x85],
    });
    const styleEdit = await waitFor(m => m.method === 'workspace/applyEdit' && m.id !== applyEdit.id);
    assert.deepEqual(styleEdit.params.edit.changes['file:///test.bas'], [{range: {start: {line: 0, character: 10}, end: {line: 0, character: 23}}, newText: '{c5 rev}Fr'}]);
    send({jsonrpc: '2.0', id: styleEdit.id, result: {applied: true}});
    assert.equal((await waitFor(m => m.id === styleId)).result, true);
  } finally {
    child.kill();
    await once(child, 'exit');
  }
}

test('the stdio LSP server publishes diagnostics for a real document', () =>
  exerciseStdioServer(new URL('../packages/basic-lsp/bin/clementina-basic-lsp.mjs', import.meta.url).pathname));

test('the LSP server bundled into the VS Code extension serves the same requests', () =>
  exerciseStdioServer(new URL('../packages/vscode-extension/dist/basic-lsp.mjs', import.meta.url).pathname));
