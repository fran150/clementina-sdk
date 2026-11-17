import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  AsmWorkspace,
  assembleForDiagnostics,
  completionsAt,
  documentOutline,
  evaluate,
  explainCa65,
  findCa65,
  hoverAt,
  instructions,
  parseAsm,
  parseCa65Output,
  readAsmProject,
  readLabels,
  signatureHelpAt,
} from '../packages/asm-lsp/dist/index.js';
import {libraryFiles} from '../packages/lib/dist/index.js';

const hasCa65 = spawnSync('ca65', ['--version'], {stdio: 'ignore'}).status === 0;
const LIB = '/lib';

/** A workspace with the Clementina library and the given files. */
function workspaceWith(files) {
  const workspace = new AsmWorkspace(() => [LIB]);
  for (const [name, text] of Object.entries(libraryFiles)) workspace.set(`${LIB}/${name}`, text, true);
  for (const [path, text] of Object.entries(files)) workspace.set(path, text);
  return workspace;
}

const GAME = `.setcpu "65C02"
.include "clementina-lib.inc"
.global start, add_point

PLAYER_X = $10                  ; player column
SPEED    = PLAYER_X * 2 + 1

.struct Enemy
  xpos .byte
  ypos .word
  hp   .byte
.endstruct

.zeropage
frame: .res 1

.code
; Main loop: waits a tick and reads the pad.
.proc start
loop:
  WaitTick
  ReadPad #0
  and #CL_PAD_UP
  beq @no
  inc frame
  lda PLAYER_X
  sta Enemy::hp
  jsr add_point
@no:
  jmp loop
:  dex
  bne :-
  bra :+
:  rts
.endproc
`;
const SCORE = `.export add_point
SCORE = $0280

; Adds one point.
add_point:
  inc SCORE
  rts
`;

test('the instruction table is the W65C02S set the grammar highlights', () => {
  const grammar = JSON.parse(readFileSync(new URL('../packages/vscode-extension/syntaxes/clementina-asm.tmLanguage.json', import.meta.url), 'utf8'));
  const pattern = grammar.repository.instruction.patterns.find(entry => entry.name === 'keyword.mnemonic.clementina-asm').match;
  const names = /\(\?:(.*)\)\(\?!/u.exec(pattern)[1].split('|').flatMap(name => name.endsWith('[0-7]') ? [0, 1, 2, 3, 4, 5, 6, 7].map(bit => name.slice(0, -5) + bit) : [name]);
  assert.deepEqual([...instructions.keys()].sort(), names.sort());
});

test('every opcode, length and mode in the table is what ca65 assembles', {skip: !hasCa65}, () => {
  const operand = {
    implied: '', accumulator: 'a', immediate: '#$12', zeroPage: 'z:$12', zeroPageX: 'z:$12,x', zeroPageY: 'z:$12,y', absolute: 'a:$1234',
    absoluteX: 'a:$1234,x', absoluteY: 'a:$1234,y', indirect: '($1234)', indexedIndirect: '($12,x)', indirectIndexed: '($12),y',
    zeroPageIndirect: '($12)', absoluteIndexedIndirect: '($1234,x)', relative: '*+2', zeroPageRelative: '$12, *+3',
  };
  const rows = [...instructions.values()].flatMap(instruction => instruction.modes.map(mode => ({instruction, mode})));
  const dir = mkdtempSync(join(tmpdir(), 'asm-lsp-ops-'));
  try {
    writeFileSync(join(dir, 'all.s'), `.setcpu "65C02"\n${rows.map(({instruction, mode}) => `  ${instruction.mnemonic} ${operand[mode.mode]}\n`).join('')}`);
    assert.equal(spawnSync('ca65', ['--cpu', '65C02', '-o', 'all.o', 'all.s'], {cwd: dir}).status, 0);
    assert.equal(spawnSync('ld65', ['-t', 'none', '-o', 'all.bin', 'all.o'], {cwd: dir}).status, 0);
    const bytes = readFileSync(join(dir, 'all.bin'));
    let offset = 0;
    for (const {instruction, mode} of rows) {
      assert.equal(bytes[offset], mode.opcode, `${instruction.mnemonic} ${mode.mode}`);
      offset += mode.bytes;
    }
    assert.equal(offset, bytes.length);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('the reader finds labels, scopes, cheap locals, records, macros and includes', () => {
  const file = parseAsm(GAME);
  const byName = name => file.symbols.find(symbol => symbol.name === name && symbol.kind !== 'import');
  assert.equal(byName('start').kind, 'proc');
  assert.equal(byName('start').endLine, 34);
  assert.equal(byName('loop').scope, 'start');
  assert.equal(byName('@no').kind, 'local');
  assert.equal(byName('frame').zeroPage, true);
  assert.deepEqual(['xpos', 'ypos', 'hp'].map(name => byName(name).offset), [0, 1, 3]);
  assert.equal(byName('PLAYER_X').doc, 'player column');
  assert.deepEqual(file.includes.map(include => include.path), ['clementina-lib.inc']);
  assert.ok(file.exports.has('start'));
  assert.deepEqual(file.unnamedLabels, [30, 33]);

  const macros = parseAsm('; Move x, y: puts it there.\n.macro Move xpos, ypos\n  lda xpos\n.local skip\nskip:\n.endmacro\n.enum\n  A_ONE\n  A_TWO = 7\n  A_THREE\n.endenum\n');
  const move = macros.symbols.find(symbol => symbol.name === 'Move');
  assert.deepEqual(move.params, ['xpos', 'ypos']);
  assert.equal(move.doc, 'Move x, y: puts it there.');
  assert.ok(!macros.symbols.some(symbol => symbol.name === 'skip'), 'labels in a macro body are not definitions');
  assert.ok(!macros.references.some(reference => reference.name === 'xpos'), 'macro parameters are not references');
  assert.deepEqual(['A_ONE', 'A_THREE'].map(name => macros.symbols.find(symbol => symbol.name === name).offset), [0, 8]);
});

test('expressions evaluate as ca65 does', () => {
  const symbols = {BASE: 0x7000};
  assert.equal(evaluate('<(BASE + $34)', name => symbols[name]), 0x34);
  assert.equal(evaluate('>BASE', name => symbols[name]), 0x70);
  assert.equal(evaluate('1 << 4 | %0001', () => undefined), 17);
  assert.equal(evaluate("'A' + 1", () => undefined), 66);
  assert.equal(evaluate('.hibyte(BASE) * 2', name => symbols[name]), 0xe0);
  assert.equal(evaluate('UNKNOWN + 1', () => undefined), undefined);
});

test('names resolve through scopes, includes and modules', () => {
  const workspace = workspaceWith({'/p/src/game.s': GAME, '/p/src/score.s': SCORE});
  const target = (line, character) => {
    const at = workspace.targetAt('/p/src/game.s', line, character);
    return at && `${at.target.path}:${at.target.symbol.span.line}`;
  };
  assert.equal(target(20, 3), '/lib/clementina-lib.inc:552', 'a library macro');
  assert.equal(target(22, 8), '/lib/clementina-lib.inc:88', 'a library constant');
  assert.equal(target(27, 7), '/p/src/score.s:4', 'a label another module exports');
  assert.equal(target(29, 7), '/p/src/game.s:19', 'a label in the same .proc');
  assert.equal(target(23, 7), '/p/src/game.s:28', 'a cheap local');
  assert.equal(target(26, 13), '/p/src/game.s:10', 'a structure field');
  assert.equal(workspace.unnamedTargetAt('/p/src/game.s', 31, 7).span.line, 30);
  assert.equal(workspace.unnamedTargetAt('/p/src/game.s', 32, 7).span.line, 33);

  const lines = workspace.occurrences('/p/src/score.s', 4, 2).map(item => `${item.path}:${item.span.line}`);
  assert.deepEqual(lines.sort(), ['/p/src/game.s:2', '/p/src/game.s:27', '/p/src/score.s:0', '/p/src/score.s:4'].sort());
  const jsr = workspace.get(`${LIB}/load.s`).parsed.lines.findIndex(text => /^cl_load:/u.test(text));
  assert.ok(workspace.occurrences(`${LIB}/load.s`, jsr, 1).length >= 2, 'the routine and the macro that calls it');
});

test('hover explains instructions in the mode the line uses, directives, symbols and numbers', () => {
  const workspace = workspaceWith({'/p/src/game.s': GAME, '/p/src/score.s': SCORE});
  const hover = (line, character, path = '/p/src/game.s') => hoverAt(workspace, path, line, character)?.markdown ?? '';
  assert.match(hover(25, 3), /\*\*LDA\*\* — Load Accumulator/u);
  assert.match(hover(25, 3), /\| \*\*Zero page\*\* \| \*\*`lda zp`\*\* \| \*\*\$A5\*\* \| \*\*2\*\* \| \*\*3\*\* \|/u);
  assert.match(hover(24, 3), /\*\*Zero page\*\*/u, 'a zero-page label');
  assert.match(hover(5, 3, '/p/src/score.s'), /\*\*Absolute\*\*/u, 'a value above $FF');
  assert.match(hover(22, 3), /\*\*Immediate\*\*/u);
  assert.match(hover(22, 3), /Flags: N Z/u);
  assert.match(hover(0, 3), /\*\*\.setcpu\*\* — ca65 control command/u);
  assert.match(hover(5, 12), /Value: \$10 \(16, %00010000\)/u);
  assert.match(hover(5, 3), /\*\*SPEED\*\* — constant[\s\S]*Value: \$21 \(33/u);
  assert.match(hover(21, 4), /ReadPad player: A = the CL_PAD_\* bits/u);
  assert.match(hover(21, 4), /Clementina library, clementina-lib\.inc:558/u);
  assert.match(hover(1, 0, '/p/src/score.s'), /\$0280 \(640\)/u);
  assert.match(hover(31, 7), /Unnamed label on line 31/u);
  assert.match(hover(26, 13), /Enemy::hp[\s\S]*Value: \$03/u);
});

test('a label shows its address once a build wrote the label file', () => {
  const workspace = workspaceWith({'/p/src/score.s': SCORE});
  workspace.addresses = new Map([['add_point', 0x7000]]);
  assert.match(hoverAt(workspace, '/p/src/score.s', 4, 2).markdown, /Value: \$7000 \(28672\)/u);
  const dir = mkdtempSync(join(tmpdir(), 'asm-lsp-lbl-'));
  try {
    writeFileSync(join(dir, 'code.lbl'), 'al 007000 .add_point\nal 000280 .SCORE\n');
    assert.deepEqual([...readLabels(join(dir, 'code.lbl'))], [['add_point', 0x7000], ['SCORE', 0x280]]);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('completion offers instructions and macros as the word, names in the operand', () => {
  const workspace = workspaceWith({'/p/src/game.s': GAME, '/p/src/score.s': SCORE});
  const labels = (line, character) => completionsAt(workspace, '/p/src/game.s', line, character).map(item => item.label);
  const word = labels(21, 2);
  assert.ok(word.includes('lda') && word.includes('bbr7') && word.includes('WaitTick') && word.includes('LoadSprites'));
  assert.ok(!word.includes('cl__asset'), 'internal library macros stay out');
  assert.ok(!word.includes('PLAYER_X'));
  const operand = labels(25, 6);
  assert.equal(operand[0], 'loop', 'the procedure\'s own labels come first');
  assert.ok(operand.includes('PLAYER_X') && operand.includes('CL_PAD_UP') && operand.includes('cl_a0') && operand.includes('add_point') && operand.includes('Enemy::hp'));
  assert.ok(!operand.includes('lda') && !operand.includes('CL_LIB_INC'));
  const dot = completionsAt(workspace, '/p/src/game.s', 13, 1);
  assert.ok(dot.some(item => item.label === '.zeropage') && dot.every(item => item.kind === 'directive'));
  assert.deepEqual(completionsAt(workspace, '/p/src/game.s', 4, 40), [], 'nothing inside a comment');
});

test('signature help names the macro parameter being typed', () => {
  const workspace = workspaceWith({'/p/src/a.s': '.include "clementina-lib.inc"\n  DrawShape file, 0, \n'});
  const help = signatureHelpAt(workspace, '/p/src/a.s', 1, 21);
  assert.equal(help.label, 'DrawShape file, shape, sprite, xpos, ypos, flips');
  assert.equal(help.activeParameter, 2);
  assert.match(help.documentation, /DrawShape file, shape, sprite, x, y\[, flips\]/u);
});

test('the outline nests what procedures and structures contain', () => {
  const workspace = workspaceWith({'/p/src/game.s': GAME});
  const outline = documentOutline(workspace, '/p/src/game.s').map(node => [node.name, node.kind, node.children.map(child => child.name)]);
  assert.deepEqual(outline, [
    ['PLAYER_X', 'constant', []], ['SPEED', 'constant', []], ['Enemy', 'struct', ['xpos', 'ypos', 'hp']], ['frame', 'label', []], ['start', 'proc', ['loop']],
  ]);
});

test('ca65 messages are parsed with their notes and made clearer', () => {
  const output = "a.s(6): Error: ':' expected\na.s(6): Error: Unexpected trailing garbage characters\na.s(9): Error: Too many macro parameters\nlib.inc(3): Note: Macro was defined here\nx.inc(1): Warning: careful\n";
  const messages = parseCa65Output(output, '/p/src');
  assert.deepEqual(messages.map(item => [item.path, item.line, item.severity]), [
    ['/p/src/a.s', 5, 'error'], ['/p/src/a.s', 5, 'error'], ['/p/src/a.s', 8, 'error'], ['/p/src/x.inc', 0, 'warning'],
  ]);
  assert.deepEqual(messages[2].notes, [{path: '/p/src/lib.inc', line: 2, message: 'Macro was defined here'}]);
  const workspace = workspaceWith({'/p/src/a.s': '\n\n\n\n\n  ldq #1\n'});
  const explained = explainCa65(workspace, messages);
  assert.equal(explained[0].message, "ldq is not a 65C02 instruction or a macro defined here (ca65: ':' expected)");
  assert.equal(explained.length, 3, 'the trailing-garbage echo is dropped');
});

test('the project gives ca65 the build\'s include directories and defines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asm-lsp-project-'));
  try {
    writeFileSync(join(dir, 'clementina.yaml'), 'build:\n  outputDirectory: out\n  assembly:\n    includeDirectories: [inc]\n    defines: {DEBUG: 1}\n    outputName: code\n');
    const project = readAsmProject(dir);
    assert.deepEqual(project.includeDirectories, [join(dir, 'inc'), join(dir, 'out/include'), join(dir, 'out/lib'), join(dir, 'out')]);
    assert.deepEqual(project.defines, {DEBUG: 1});
    assert.equal(project.labelFile, join(dir, 'out/code.lbl'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('ca65 reports errors in the unsaved text, with includes from the library', {skip: !hasCa65}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asm-lsp-ca65-'));
  try {
    mkdirSync(join(dir, 'lib'));
    for (const [name, text] of Object.entries(libraryFiles)) writeFileSync(join(dir, 'lib', name), text);
    mkdirSync(join(dir, 'src'));
    const path = join(dir, 'src', 'game.s');
    writeFileSync(path, '');
    const options = {ca65: findCa65(), cwd: dir, includeDirectories: [join(dir, 'lib')]};
    assert.deepEqual(await assembleForDiagnostics(path, GAME, options), []);
    const messages = await assembleForDiagnostics(path, GAME.replace('inc frame', 'inc frame\n  ReadPad #0, #1'), options);
    assert.deepEqual(messages.map(item => [item.path, item.line, item.message]), [[path, 25, 'Too many macro parameters']]);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('the stdio server indexes a project and answers an editor', {skip: !hasCa65}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asm-lsp-server-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../packages/asm-lsp/bin/clementina-asm-lsp.mjs', import.meta.url))], {stdio: ['pipe', 'pipe', 'pipe']});
  const messages = [];
  let buffer = Buffer.alloc(0);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = Number(/Content-Length: (\d+)/iu.exec(buffer.subarray(0, headerEnd).toString('ascii'))[1]);
      if (buffer.length < headerEnd + 4 + length) return;
      messages.push(JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')));
      buffer = buffer.subarray(headerEnd + 4 + length);
    }
  });
  const send = message => {
    const json = JSON.stringify({jsonrpc: '2.0', ...message});
    child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  };
  let nextId = 1;
  const request = async (method, params) => {
    const id = nextId++;
    send({id, method, params});
    return (await waitFor(message => message.id === id));
  };
  const waitFor = async predicate => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for the server. stderr: ${stderr} messages: ${JSON.stringify(messages).slice(-1500)}`);
  };
  try {
    writeFileSync(join(dir, 'clementina.yaml'), 'build:\n  outputDirectory: build\n  assembly:\n    outputName: code\n');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'score.s'), SCORE);
    const game = join(dir, 'src', 'game.s');
    writeFileSync(game, GAME);
    const uri = pathToFileURL(game).href;
    const library = join(dir, 'library');
    const init = await request('initialize', {processId: null, rootUri: pathToFileURL(dir).href, workspaceFolders: [{uri: pathToFileURL(dir).href, name: 'game'}], capabilities: {}, initializationOptions: {libraryDirectory: library}});
    assert.equal(init.result.capabilities.renameProvider.prepareProvider, true);
    send({method: 'initialized', params: {}});
    send({method: 'textDocument/didOpen', params: {textDocument: {uri, languageId: 'clementina-asm', version: 1, text: GAME.replace('inc frame', 'inc frame\n  ldq #1')}}});
    const published = await waitFor(message => message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri && message.params.diagnostics.length);
    assert.deepEqual(published.params.diagnostics.map(item => [item.range.start.line, item.source, item.message]), [[25, 'ca65', "ldq is not a 65C02 instruction or a macro defined here (ca65: ':' expected)"]]);

    send({method: 'textDocument/didChange', params: {textDocument: {uri, version: 2}, contentChanges: [{text: GAME}]}});
    await waitFor(message => message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri && message.params.diagnostics.length === 0);

    const hover = await request('textDocument/hover', {textDocument: {uri}, position: {line: 21, character: 4}});
    assert.match(hover.result.contents.value, /\*\*ReadPad\*\* — macro/u);
    const definition = await request('textDocument/definition', {textDocument: {uri}, position: {line: 21, character: 4}});
    assert.equal(definition.result.uri, pathToFileURL(join(library, 'clementina-lib.inc')).href);
    assert.equal(readFileSync(join(library, 'clementina-lib.inc'), 'utf8'), libraryFiles['clementina-lib.inc']);
    const across = await request('textDocument/definition', {textDocument: {uri}, position: {line: 27, character: 7}});
    assert.equal(across.result.uri, pathToFileURL(join(dir, 'src', 'score.s')).href);

    const refused = await request('textDocument/prepareRename', {textDocument: {uri}, position: {line: 21, character: 4}});
    assert.match(refused.error.message, /belongs to the Clementina library/u);
    const rename = await request('textDocument/rename', {textDocument: {uri}, position: {line: 29, character: 7}, newName: 'main_loop'});
    assert.deepEqual(rename.result.changes[uri].map(edit => edit.range.start.line).sort((a, b) => a - b), [19, 29]);

    const symbols = await request('textDocument/documentSymbol', {textDocument: {uri}});
    assert.deepEqual(symbols.result.map(item => item.name), ['PLAYER_X', 'SPEED', 'Enemy', 'frame', 'start']);
    const links = await request('textDocument/documentLink', {textDocument: {uri}});
    assert.equal(links.result[0].target, pathToFileURL(join(library, 'clementina-lib.inc')).href);
    const folds = await request('textDocument/foldingRange', {textDocument: {uri}});
    assert.ok(folds.result.some(fold => fold.startLine === 18 && fold.endLine === 34));
  } finally {
    child.kill();
    rmSync(dir, {recursive: true, force: true});
  }
});
