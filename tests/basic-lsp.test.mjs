import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {analyzeDiagnostics, completionsFor, hoverAt} from '../packages/basic-lsp/dist/index.js';
import {basicTokenTables} from '../packages/basic/dist/index.js';

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
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});
