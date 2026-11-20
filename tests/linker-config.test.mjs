import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  checkWithLd65,
  clementinaMemoryMap,
  configCompletions,
  configDefinition,
  configDiagnostics,
  configHover,
  configOutline,
  evaluateConfigExpression,
  manifestAddress,
  memoryAreas,
  parseConfig,
  parseLd65Output,
  readAsmProject,
  tokenizeConfig,
} from '../packages/asm-lsp/dist/index.js';

const hasLd65 = spawnSync('ld65', ['--version'], {stdio: 'ignore'}).status === 0;
const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const STARTER = read('templates/starter/link.cfg');
/** The starter's project: BASIC calls the code at $7000, below a memoryTop of $7000. */
const PROJECT = {returnsToBasic: true, memoryTop: 0x7000, loadAddress: 0x7000, linked: true, segments: [{name: 'CODE', file: 'src/hello.s', line: 2}]};
const lines = (text, project = PROJECT) => configDiagnostics(parseConfig(text), project).map(item => `${item.span.line + 1} ${item.severity}: ${item.message}`);

test('the SDK\'s own linker configurations pass every check', () => {
  assert.deepEqual(lines(STARTER), []);
  assert.deepEqual(lines(read('examples/catch-the-star/link.cfg')), []);
  // library-demo and the assembly-only fixture replace BASIC and load at $1800.
  const own = {returnsToBasic: false, loadAddress: 0x1800, linked: true, segments: []};
  assert.deepEqual(lines(read('examples/library-demo/link.cfg'), own).filter(line => !line.includes('BASIC')), []);
  assert.deepEqual(lines(read('tests/fixtures/assembly-only/link.cfg'), own), []);
});

test('the parser reads blocks, names, attributes and values, with optional commas', () => {
  const config = parseConfig(STARTER);
  assert.deepEqual(config.blocks.map(block => [block.key, block.items.map(item => item.name)]), [
    ['MEMORY', ['ZP', 'RAM']],
    ['SEGMENTS', ['ZEROPAGE', 'CODE', 'RODATA', 'DATA', 'BSS']],
  ]);
  assert.deepEqual(memoryAreas(config).map(area => [area.item.name, area.start, area.size, area.file]), [['ZP', 0x98, 0x48, '%O'], ['RAM', 0x7000, 0x1000, '%O']]);
  const loose = parseConfig('memory { RAM: start = $10 size = 4 * (2 + 1) file = "" ; } # comment\nFILES { %O: format = bin; "x.bin": format = bin; }');
  assert.deepEqual(loose.problems, []);
  assert.deepEqual(loose.blocks[0].items[0].attributes.map(attribute => [attribute.key, attribute.value.text]), [['start', '$10'], ['size', '4 * ( 2 + 1 )'], ['file', '""']]);
  assert.deepEqual(loose.blocks[1].items.map(item => [item.name, item.nameKind]), [['%O', 'percent'], ['x.bin', 'string']]);
  assert.deepEqual(tokenizeConfig('a # b').tokens.map(token => token.text), ['a']);
});

test('expressions follow ld65: + - * /, parentheses, symbols and %S', () => {
  const tokens = text => tokenizeConfig(text).tokens;
  assert.equal(evaluateConfigExpression(tokens('$1000 - 2 * (3 + 1) / 2'), () => undefined).value, 0x1000 - 4);
  assert.equal(evaluateConfigExpression(tokens('-5 + 10'), () => undefined).value, 5);
  assert.equal(evaluateConfigExpression(tokens('%S + 1'), () => undefined).value, 0x201);
  assert.equal(evaluateConfigExpression(tokens('TOP - $100'), name => (name === 'TOP' ? 0x8000 : undefined)).value, 0x7f00);
  assert.equal(evaluateConfigExpression(tokens('UNKNOWN'), () => undefined).value, undefined);
  assert.match(evaluateConfigExpression(tokens('1 2'), () => undefined).error.message, /Unexpected '2'/u);
  const symbols = parseConfig('SYMBOLS { TOP: type = export, value = $8000; SIZE: type = weak, value = TOP - $7000; }\nMEMORY { RAM: start = $7000, size = SIZE, file = %O; }');
  assert.deepEqual(memoryAreas(symbols).map(area => area.size), [0x1000]);
});

test('ld65\'s rules are checked as you type', () => {
  const text = [
    'BOGUS { }',
    'SEGMENTS { EARLY: load = RAM; }',
    'MEMORY {',
    '  RAM: start = $7000, size = $1000, type = rx, colour = 1;',
    '  RAM: start = $7000, size = $10;',
    '  ZP: size = $10, start = $98, start = $99;',
    '  B: start = UNDEFINED, size = $10;',
    '  C: start = $9000 size = 2 ^ 3;',
    '}',
    'SEGMENTS {',
    '  CODE: load = ram, define = maybe;',
    '  DATA: type = rw;',
    '  BSS: load = RAM, align = 2, start = $7100;',
    '}',
    'SYMBOLS { in: type = import, value = 1; out: type = export; }',
    'FEATURES { FOO: x = 1; CONDES: type = constructor; }',
    'FILES { %O: format = elf; }',
    'MEMORY { D: start = $7000, size = 1',
  ].join('\n');
  const errors = configDiagnostics(parseConfig(text), undefined).filter(item => item.severity === 'error').map(item => `${item.span.line + 1}: ${item.message}`);
  for (const expected of [
    /^1: BOGUS is not an ld65 block/u,
    /^2: MEMORY must come before SEGMENTS/u,
    /^4: type is `ro`, `rw`, not rx/u,
    /^4: colour is not an attribute of a memory area/u,
    /^5: RAM is defined twice in MEMORY \(first on line 4\)/u,
    /^6: start is given twice/u,
    /^7: UNDEFINED is not defined in SYMBOLS, so ld65 cannot compute B's start/u,
    /^8: ld65 does not accept '\^' here/u,
    /^11: No memory area is named ram \(names are case-sensitive: RAM\)/u,
    /^11: define is `yes`, `no`, not maybe/u,
    /^12: DATA needs load/u,
    /^13: Only one of align, start and offset may be used/u,
    /^15: An import must not have a value/u,
    /^15: An export needs a value/u,
    /^16: FEATURES has CONDES, STARTADDRESS, not FOO/u,
    /^16: CONDES needs segment/u,
    /^17: format is `bin`, `binary`, `o65`, `atari`, not elf/u,
    /^18: ';' expected after D's attributes/u,
  ]) assert.ok(errors.some(line => expected.test(line)), `${expected} not in:\n${errors.join('\n')}`);
});

test('memory areas are checked against Clementina\'s memory map and the project', () => {
  const config = start => `MEMORY {\n  ZP: start = $00, size = $100, type = rw, file = "";\n  RAM: start = ${start}, size = $1000, type = rw, file = %O;\n  IO: start = $C000, size = $10;\n  VIA: start = $C000, size = $10, file = "via.bin";\n}\nSEGMENTS {\n  ZEROPAGE: load = ZP, type = zp;\n  FAR: load = RAM, type = zp;\n  CODE: load = RAM, type = ro;\n  REGS: load = VIA, type = rw;\n}\n`;
  const found = lines(config('$1000'), {...PROJECT, segments: [{name: 'HEADER', file: 'src/head.s', line: 0}]});
  for (const expected of [
    /^2 warning: ZP \(\$00-\$FF\) overlaps BASIC zero page \(\$00-\$97\): .*returns to BASIC/u,
    /^2 warning: ZP .* overlaps Kernel zero page \(\$F0-\$FF\)/u,
    /^2 information: ZP .* overlaps WozMon zero page/u,
    /^3 warning: RAM \(\$1000-\$1FFF\) overlaps Kernel image \(\$0400-\$15FF\)/u,
    /^3 warning: RAM \(\$1000-\$1FFF\) overlaps BASIC \(\$1600-\$6FFF\): .*Move RAM above build.basic.memoryTop \(\$7000\)/u,
    /^5 warning: VIA \(\$C000-\$C00F\) overlaps I\/O/u,
    /^5 warning: VIA \(\$C000-\$C00F\) overlaps memory area IO/u,
    /^9 warning: FAR is a zp segment, but RAM \(\$1000-\$1FFF\) is not all in zero page/u,
    /^3 warning: clementina.yaml loads the code at \$7000 \(build.assembly.loadAddress\), but RAM, the first area written to the output, starts at \$1000/u,
    /^7 warning: src\/head.s:1 puts code or data in segment HEADER, which SEGMENTS does not place/u,
  ]) assert.ok(found.some(line => expected.test(line)), `${expected} not in:\n${found.join('\n')}`);
  // IO holds no segment and no file: describing the VIA's registers there is fine.
  assert.ok(!found.some(line => line.startsWith('4 ') && line.includes('I/O')));

  // With BASIC's MEMSIZ left at $C000, the hint is to lower it.
  assert.ok(lines(STARTER, {...PROJECT, memoryTop: undefined}).some(line => /RAM \(\$7000-\$7FFF\) overlaps BASIC \(\$1600-\$BFFF\).*Set build.basic.memoryTop to \$7000/u.test(line)));
  // A program that replaces BASIC may use BASIC's memory; without a project it is only a note.
  assert.deepEqual(lines(config('$7000').replace(/  ZP:.*\n/u, '').replace(/  ZEROPAGE:.*\n/u, '').replace(/  FAR:.*\n/u, ''), {...PROJECT, returnsToBasic: false}).filter(line => line.includes('BASIC')), []);
  assert.ok(lines(STARTER, undefined).every(line => line.includes(' information: ')));
  // Areas in different banks do not overlap.
  assert.deepEqual(lines('MEMORY {\n  A: start = $8000, size = $4000, bank = 1;\n  B: start = $8000, size = $4000, bank = 2;\n}\n', {...PROJECT, linked: false}), []);
});

test('the memory map matches specs/cpu-memory-map.json', () => {
  const spec = JSON.parse(read('specs/cpu-memory-map.json'));
  const map = clementinaMemoryMap();
  const boundaries = entries => entries.map(entry => entry.start);
  const mapStarts = new Set(boundaries(map));
  const page = name => spec.pages.find(item => item.name === name).blocks;
  // Every zero-page and page-2 block starts where a map entry does.
  for (const block of [...page('ZERO_PAGE'), ...page('INPUT_PAGE')]) assert.ok(mapStarts.has(block.start), `${block.name} at ${block.start}`);
  for (const region of spec.baseRam) assert.ok(mapStarts.has(region.start), region.name);
  for (const region of spec.regions.filter(item => item.owner !== 'ram')) assert.ok(mapStarts.has(region.start), region.name);
  assert.equal(map.find(entry => entry.name === 'Kernel image').end, spec.image.kernelRegionEndExclusive);
  assert.equal(map.find(entry => entry.name === 'BASIC').end, spec.image.heapEndExclusive);
  assert.equal(map.find(entry => entry.name === 'Program zero page').end - 0x98, 72);
  // The map tiles $0000-$FFFF with no gap, whatever memoryTop is.
  for (const top of [0x1600, 0x7000, 0x8000, 0xa000, 0xc000]) {
    const entries = clementinaMemoryMap(top);
    entries.forEach((entry, index) => assert.equal(entry.start, index ? entries[index - 1].end : 0, `${top}: ${entry.name}`));
    assert.equal(entries.at(-1).end, 0x10000);
  }
});

test('hover explains blocks, attributes, numbers, memory areas and segments', () => {
  const config = parseConfig(STARTER);
  const at = (line, character) => configHover(config, line, character, PROJECT)?.markdown ?? '';
  assert.match(at(0, 2), /\*\*MEMORY\*\*\n\nThe memory areas/u);
  const ram = at(2, 3);
  assert.match(ram, /\*\*RAM\*\*: memory area \$7000-\$7FFF/u);
  assert.match(ram, /segments: CODE \(ro\), RODATA \(ro\), DATA \(rw\), BSS \(bss\)/u);
  assert.match(ram, /\$7000-\$7FFF in Free RAM/u);
  assert.match(at(1, 6), /\*\*start\*\* \(required\)/u);
  assert.match(at(2, 15), /\*\*\$7000\*\* = 28672\n\nAs an address: Free RAM/u);
  assert.match(at(1, 13), /\*\*\$98\*\* = 152\n\nAs an address: Program zero page/u);
  assert.match(at(2, 46), /\*\*%O\*\*/u);
  const code = at(6, 4);
  assert.match(code, /\*\*CODE\*\*: segment, type ro/u);
  assert.match(code, /loaded into RAM \(\$7000-\$7FFF\)/u);
  assert.match(code, /used in src\/hello.s:3/u);
  assert.match(at(6, 15), /\*\*RAM\*\*: memory area/u);
  assert.match(configHover(config, 1, 2, {...PROJECT, memoryTop: undefined})?.markdown ?? '', /Program zero page/u);
  // A zero-page area over BASIC's variables is flagged.
  const zp = configHover(parseConfig('MEMORY { ZP: start = $80, size = $20; }'), 0, 10, PROJECT).markdown;
  assert.match(zp, /\$80-\$97 in BASIC zero page ⚠ BASIC's/u);
});

test('completion offers blocks, names, attributes and values', () => {
  const labels = (text, line, character, project = PROJECT) => configCompletions(parseConfig(text), line, character, project).map(item => item.label);
  assert.deepEqual(labels('', 0, 0), ['MEMORY', 'FILES', 'SEGMENTS', 'FEATURES', 'SYMBOLS', 'FORMATS']);
  assert.deepEqual(labels('MEMORY {\n  \n}', 1, 2), ['ZP', 'RAM', 'PAGE2']);
  const ram = configCompletions(parseConfig('MEMORY {\n  \n}'), 1, 2, PROJECT).find(item => item.label === 'RAM');
  assert.equal(ram.snippet, 'RAM: start = \\$7000, size = \\$1000, type = rw, file = %O;');
  assert.deepEqual(labels('MEMORY {\n  RAM: start = $7000, \n}', 1, 22), ['size', 'type', 'file', 'define', 'fill', 'fillval', 'bank']);
  assert.deepEqual(labels('MEMORY {\n  RAM: start = \n}', 1, 15), ['$98', '$0280', '$7000', '$8000']);
  assert.deepEqual(labels('MEMORY {\n  RAM: type = r\n}', 1, 15), ['ro', 'rw']);
  assert.deepEqual(labels('MEMORY {\n  RAM: file = \n}', 1, 14), ['%O', '""']);
  const segments = `${STARTER}`.replace('  CODE: load=RAM, type=ro;\n', '  CODE: load = \n');
  assert.deepEqual(labels(segments, 6, 15), ['ZP', 'RAM']);
  const names = configCompletions(parseConfig('MEMORY { ZP: start=$98, size=$48; RAM: start=$7000, size=$1000; }\nSEGMENTS {\n  \n}'), 2, 2, {...PROJECT, segments: [{name: 'HEADER', file: 'src/a.s', line: 0}]});
  assert.equal(names[0].label, 'HEADER');
  assert.equal(names.find(item => item.label === 'ZEROPAGE').snippet, 'ZEROPAGE: load = ${1:ZP}, type = zp;');
  assert.equal(names.find(item => item.label === 'BSS').snippet, 'BSS: load = ${1:RAM}, type = bss, define = yes;');
  assert.deepEqual(labels('FEATURES {\n  \n}', 1, 2), ['CONDES', 'STARTADDRESS']);
});

test('definitions and the outline follow memory areas and segments', () => {
  const config = parseConfig(STARTER);
  assert.deepEqual(configDefinition(config, 6, 15), {line: 2, start: 2, end: 5});
  assert.deepEqual(configOutline(config).map(block => [block.name, block.children.map(child => `${child.name} ${child.detail}`)]), [
    ['MEMORY', ['ZP $98-$DF', 'RAM $7000-$7FFF']],
    ['SEGMENTS', ['ZEROPAGE ZP, zp', 'CODE RAM, ro', 'RODATA RAM, ro', 'DATA RAM, rw', 'BSS RAM, bss']],
  ]);
});

test('the manifest gives the checks memoryTop, loadAddress, linkerConfig and program.entry', () => {
  assert.equal(manifestAddress('$7000'), 0x7000);
  assert.equal(manifestAddress('0x7000'), 0x7000);
  assert.equal(manifestAddress(28672), 0x7000);
  assert.equal(manifestAddress('7000'), 7000);
  assert.equal(manifestAddress('nope'), undefined);
  const dir = mkdtempSync(join(tmpdir(), 'ld65-project-'));
  try {
    writeFileSync(join(dir, 'clementina.yaml'), read('templates/starter/clementina.yaml'));
    const project = readAsmProject(dir);
    assert.equal(project.returnsToBasic, true);
    assert.equal(project.memoryTop, 0x7000);
    assert.equal(project.loadAddress, 0x7000);
    assert.equal(project.linkerConfig, join(dir, 'link.cfg'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('ld65 messages are read for the configuration only', () => {
  const output = 'ld65: Warning: /tmp/x/link.cfg(3): ALIGN_LOAD attribute specified\nld65: Error: /tmp/x/link.cfg(5): Invalid memory area \'B\'\nld65: Error: other.cfg(1): elsewhere\nld65: Error: No object files to link\n';
  assert.deepEqual(parseLd65Output(output, '/tmp/x/link.cfg', '/tmp/x'), [
    {line: 2, severity: 'warning', message: 'ALIGN_LOAD attribute specified'},
    {line: 4, severity: 'error', message: 'Invalid memory area \'B\''},
  ]);
});

test('ld65 checks the unsaved text and writes nothing', {skip: !hasLd65}, async () => {
  assert.deepEqual(await checkWithLd65('/nowhere/link.cfg', STARTER, 'ld65'), []);
  const messages = await checkWithLd65('/nowhere/link.cfg', 'MEMORY {\n  RAM: start = $7000, size = $100, file = "out.bin";\n}\nFORMATS { o65: os = lunix, id = 1; }\n', 'ld65');
  assert.deepEqual(messages, [{line: 3, severity: 'error', message: 'Operating system does not support the ID attribute'}]);
});

test('the stdio server checks, explains and completes a link.cfg', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ld65-lsp-server-'));
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
  const waitFor = async predicate => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for the server. stderr: ${stderr} messages: ${JSON.stringify(messages).slice(-1500)}`);
  };
  const request = async (method, params) => {
    const id = nextId++;
    send({id, method, params});
    return waitFor(message => message.id === id);
  };
  try {
    writeFileSync(join(dir, 'clementina.yaml'), read('templates/starter/clementina.yaml'));
    const path = join(dir, 'link.cfg');
    writeFileSync(path, STARTER);
    const uri = pathToFileURL(path).href;
    await request('initialize', {processId: null, rootUri: pathToFileURL(dir).href, workspaceFolders: [{uri: pathToFileURL(dir).href, name: 'game'}], capabilities: {}, initializationOptions: {libraryDirectory: join(dir, 'library'), diagnostics: 'off'}});
    send({method: 'initialized', params: {}});
    send({method: 'textDocument/didOpen', params: {textDocument: {uri, languageId: 'clementina-ld65', version: 1, text: STARTER.replace('start=$7000', 'start=$1800')}}});
    const published = await waitFor(message => message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri && message.params.diagnostics.length);
    const found = published.params.diagnostics.map(item => `${item.range.start.line} ${item.source}: ${item.message}`);
    assert.ok(found.some(line => /^2 clementina: RAM \(\$1800-\$27FF\) overlaps BASIC/u.test(line)), found.join('\n'));
    assert.ok(found.some(line => /^2 clementina: clementina.yaml loads the code at \$7000/u.test(line)), found.join('\n'));

    send({method: 'textDocument/didChange', params: {textDocument: {uri, version: 2}, contentChanges: [{text: STARTER}]}});
    await waitFor(message => message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri && message.params.diagnostics.length === 0);

    const hover = await request('textDocument/hover', {textDocument: {uri}, position: {line: 2, character: 3}});
    assert.match(hover.result.contents.value, /\*\*RAM\*\*: memory area \$7000-\$7FFF/u);
    const completion = await request('textDocument/completion', {textDocument: {uri}, position: {line: 2, character: 2}, context: {triggerKind: 1}});
    assert.deepEqual(completion.result.map(item => item.label), ['PAGE2']);
    const definition = await request('textDocument/definition', {textDocument: {uri}, position: {line: 6, character: 15}});
    assert.deepEqual(definition.result, {uri, range: {start: {line: 2, character: 2}, end: {line: 2, character: 5}}});
    const symbols = await request('textDocument/documentSymbol', {textDocument: {uri}});
    assert.deepEqual(symbols.result.map(item => item.name), ['MEMORY', 'SEGMENTS']);
    const folds = await request('textDocument/foldingRange', {textDocument: {uri}});
    assert.deepEqual(folds.result, [{startLine: 0, endLine: 3}, {startLine: 4, endLine: 10}]);
  } finally {
    child.kill();
    rmSync(dir, {recursive: true, force: true});
  }
});
