import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {
  analyzeDiagnostics,
  completionsFor,
  completionsAt,
  definitionAt,
  documentSymbols,
  formatBasicSource,
  hoverAt,
  basicSignatureByKeyword,
  referencesAt,
  renameAt,
  renumberBasicSource,
  semanticSpans,
  signatureHelpAt,
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
    label: 'MID$(string, start, length?)', parameters: ['string', 'start', 'length?'], activeParameter: 2,
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

test('the stdio LSP server publishes diagnostics for a real document', async () => {
  const binPath = new URL('../packages/basic-lsp/bin/clementina-basic-lsp.mjs', import.meta.url).pathname;
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
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});
