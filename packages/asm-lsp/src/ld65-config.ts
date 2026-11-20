/**
 * ld65 linker configurations (`link.cfg`): a tokenizer and a tolerant parser
 * that keeps going after an error, the tables of blocks and attributes ld65
 * 2.19 accepts, and evaluation of the attribute expressions. Positions are
 * zero-based lines and characters, as in LSP.
 */
import type {Span} from './parser.js';

export type CfgTokenKind = 'identifier' | 'number' | 'string' | 'percent' | 'punctuation' | 'invalid';

export interface CfgToken {
  kind: CfgTokenKind;
  text: string;
  line: number;
  start: number;
  end: number;
}

export interface CfgValue {
  tokens: CfgToken[];
  /** The value's text as written, tokens joined by single spaces. */
  text: string;
  span: Span;
}

export interface CfgAttribute {
  /** As written. */
  name: string;
  /** Lowercase, as the tables name it. */
  key: string;
  span: Span;
  value?: CfgValue;
}

export interface CfgItem {
  /** A memory area, segment, file, feature, symbol or format name, without quotes. */
  name: string;
  nameKind: 'identifier' | 'string' | 'percent';
  span: Span;
  attributes: CfgAttribute[];
  /** The line of the `;` that ends the item, or of its last token. */
  endLine: number;
}

export interface CfgBlock {
  /** As written. */
  name: string;
  /** Uppercase: MEMORY, FILES, SEGMENTS, FEATURES, SYMBOLS or FORMATS. */
  key: string;
  span: Span;
  items: CfgItem[];
  /** Lines of the `{` and the `}` (the last line when the block is not closed). */
  openLine: number;
  closeLine: number;
  /** Position just after the `}`, or undefined when the block is not closed. */
  close?: {line: number; character: number};
}

export interface CfgProblem {
  span: Span;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParsedConfig {
  lines: string[];
  tokens: CfgToken[];
  blocks: CfgBlock[];
  problems: CfgProblem[];
}

// --- What ld65 accepts -------------------------------------------------------

export type CfgValueType = 'expression' | 'boolean' | 'enum' | 'memory' | 'segment' | 'identifier' | 'file' | 'any';

export interface CfgAttributeSpec {
  name: string;
  type: CfgValueType;
  values?: string[];
  required?: boolean;
  doc: string;
}

export interface CfgBlockSpec {
  name: string;
  doc: string;
  /** Names an item can have, when the block allows only some (FEATURES, FORMATS, FILES). */
  itemNames?: Array<{name: string; doc: string}>;
  /** Attributes by item name, or `*` for every item. */
  attributes: Record<string, CfgAttributeSpec[]>;
  /** The syntax of one item, for hover and completion. */
  example: string;
}

const yesNo = ['yes', 'no'];
export const booleanValues = ['yes', 'no', 'true', 'false'];
const fillval: CfgAttributeSpec = {name: 'fillval', type: 'expression', doc: 'The byte that fills gaps, instead of `$00`.'};

export const cfgBlocks: CfgBlockSpec[] = [
  {
    name: 'MEMORY',
    doc: 'The memory areas: address ranges that segments are placed in, and the file each one is written to. Must come before FILES and SEGMENTS.',
    example: 'RAM: start = $7000, size = $1000, type = rw, file = %O;',
    attributes: {'*': [
      {name: 'start', type: 'expression', required: true, doc: 'The CPU address the area starts at.'},
      {name: 'size', type: 'expression', required: true, doc: 'The area\'s size in bytes. ld65 fails when its segments do not fit.'},
      {name: 'type', type: 'enum', values: ['ro', 'rw'], doc: '`ro` (read-only) or `rw` (read and write). Informational: ld65 does not check it against the segments.'},
      {name: 'file', type: 'file', doc: 'The output file the area\'s bytes are written to: `%O` is the file the build names (the `.prg`), `""` writes nothing, which suits RAM that is only reserved, such as zero page.'},
      {name: 'define', type: 'boolean', values: yesNo, doc: '`yes` exports `__NAME_START__`, `__NAME_SIZE__` and `__NAME_LAST__` for the area, to use in assembly.'},
      {name: 'fill', type: 'boolean', values: yesNo, doc: '`yes` pads the output to the area\'s full size.'},
      fillval,
      {name: 'bank', type: 'expression', doc: 'A number ld65 attaches to the area and exports as `.bank(...)` of its symbols. On Clementina, the extended RAM bank ($8000-$BFFF, 0-31) the area is meant for.'},
    ]},
  },
  {
    name: 'FILES',
    doc: 'The format of each output file. Must come after MEMORY.',
    example: '%O: format = bin;',
    attributes: {'*': [{name: 'format', type: 'enum', values: ['bin', 'binary', 'o65', 'atari'], doc: 'The output format. Clementina loads plain binaries: `bin`.'}]},
  },
  {
    name: 'SEGMENTS',
    doc: 'Where each segment the sources use (`.segment "NAME"`, `.code`, `.zeropage`...) is loaded and run. Must come after MEMORY.',
    example: 'CODE: load = RAM, type = ro;',
    attributes: {'*': [
      {name: 'load', type: 'memory', required: true, doc: 'The memory area the segment is stored in, in the output file.'},
      {name: 'run', type: 'memory', doc: 'The memory area the segment runs from, when the program copies it there itself. Defaults to `load`.'},
      {name: 'type', type: 'enum', values: ['ro', 'rw', 'bss', 'zp', 'overwrite'], doc: '`ro` code or constants, `rw` initialized data, `bss` uninitialized data (takes no room in the file), `zp` uninitialized zero-page data, `overwrite` bytes that replace part of another segment at `start`.'},
      {name: 'define', type: 'boolean', values: yesNo, doc: '`yes` exports `__NAME_LOAD__`, `__NAME_RUN__` and `__NAME_SIZE__` for the segment, such as `__BSS_RUN__` to clear BSS.'},
      {name: 'align', type: 'expression', doc: 'Starts the segment at a multiple of this (a power of two), such as `$100` for a page.'},
      {name: 'align_load', type: 'expression', doc: 'Aligns the load address when it differs from the run address.'},
      {name: 'start', type: 'expression', doc: 'Places the segment at this exact address inside its area.'},
      {name: 'offset', type: 'expression', doc: 'Places the segment this many bytes from the start of its area.'},
      {name: 'optional', type: 'boolean', values: yesNo, doc: '`yes` keeps ld65 quiet when no object file has the segment.'},
      fillval,
    ]},
  },
  {
    name: 'FEATURES',
    doc: 'Linker features: constructor and destructor tables (CONDES) and the default start address (STARTADDRESS).',
    example: 'STARTADDRESS: default = $7000;',
    itemNames: [
      {name: 'CONDES', doc: 'Builds a table of the routines the sources mark with `.constructor`, `.destructor` or `.interruptor`.'},
      {name: 'STARTADDRESS', doc: 'The value of `%S` when the command line does not set it with `-S` (ld65\'s own default is $0200).'},
    ],
    attributes: {
      CONDES: [
        {name: 'segment', type: 'segment', required: true, doc: 'The segment the table is written to.'},
        {name: 'type', type: 'enum', values: ['constructor', 'destructor', 'interruptor'], required: true, doc: 'Which routines go in the table.'},
        {name: 'label', type: 'identifier', doc: 'The label exported at the start of the table.'},
        {name: 'count', type: 'identifier', doc: 'The symbol exported with the number of entries.'},
        {name: 'order', type: 'enum', values: ['increasing', 'decreasing'], doc: 'Priority order of the entries.'},
        {name: 'import', type: 'identifier', doc: 'A symbol imported whenever the table is not empty.'},
      ],
      STARTADDRESS: [{name: 'default', type: 'expression', doc: 'The start address `%S` stands for.'}],
    },
  },
  {
    name: 'SYMBOLS',
    doc: 'Symbols the configuration defines for the program, or requires from it.',
    example: '__STACKSIZE__: type = weak, value = $0100;',
    attributes: {'*': [
      {name: 'type', type: 'enum', values: ['export', 'import', 'weak'], required: true, doc: '`export` defines the symbol, `weak` defines it unless an object file does, `import` requires an object file to define it.'},
      {name: 'value', type: 'expression', doc: 'The value of an `export` or `weak` symbol (required for those, not allowed for `import`).'},
      {name: 'addrsize', type: 'enum', values: ['zp', 'zeropage', 'direct', 'abs', 'absolute', 'near', 'far', 'long', 'dword'], doc: 'The symbol\'s address size; `zp` lets ca65 use zero-page addressing with it.'},
    ]},
  },
  {
    name: 'FORMATS',
    doc: 'Options of the o65 and Atari output formats. Clementina programs are plain binaries and do not need this block.',
    example: 'o65: os = cc65, type = small;',
    itemNames: [
      {name: 'o65', doc: 'The o65 relocatable format.'},
      {name: 'atari', doc: 'The Atari segmented executable format.'},
      {name: 'bin', doc: 'Plain binaries, which take no options.'},
      {name: 'binary', doc: 'Plain binaries, which take no options.'},
    ],
    attributes: {
      o65: [
        {name: 'os', type: 'enum', values: ['lunix', 'osa65', 'cc65', 'opencbm'], doc: 'The operating system the file is for.'},
        {name: 'type', type: 'enum', values: ['small', 'large'], doc: 'Small or large o65 model.'},
        {name: 'version', type: 'expression', doc: 'The OS version.'},
        {name: 'id', type: 'expression', doc: 'The module id (some operating systems only).'},
        {name: 'import', type: 'any', doc: 'Symbols the file imports.'},
        {name: 'export', type: 'any', doc: 'Symbols the file exports.'},
      ],
      atari: [
        {name: 'runad', type: 'any', doc: 'The run address.'},
        {name: 'initad', type: 'any', doc: '`AREA: expression`, an init address.'},
      ],
      bin: [], binary: [],
    },
  },
];

export function blockSpec(name: string): CfgBlockSpec | undefined {
  return cfgBlocks.find(block => block.name === name.toUpperCase());
}

/** The attributes an item can have, by its block and name. */
export function attributeSpecs(block: string, item: string): CfgAttributeSpec[] {
  const spec = blockSpec(block);
  if (!spec) return [];
  if (spec.itemNames) {
    const match = Object.keys(spec.attributes).find(key => key.toLowerCase() === item.toLowerCase());
    return match ? spec.attributes[match]! : [];
  }
  return spec.attributes['*'] ?? [];
}

export const percentDocs: Record<string, string> = {
  '%O': 'The output file the build names: `-o`, the project\'s `<outputName>.prg`.',
  '%S': 'The start address: `-S` on the command line, else FEATURES `STARTADDRESS`, else $0200. The Clementina build does not pass `-S`.',
};

// --- Tokens ------------------------------------------------------------------

export function tokenizeConfig(text: string): {lines: string[]; tokens: CfgToken[]} {
  const lines = text.split(/\r?\n/u);
  const tokens: CfgToken[] = [];
  lines.forEach((source, line) => {
    let at = 0;
    while (at < source.length) {
      const char = source[at]!;
      if (char === '#') break;
      if (/\s/u.test(char)) { at += 1; continue; }
      const rest = source.slice(at);
      const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest)
        ?? /^\$[0-9A-Fa-f]*/u.exec(rest)
        ?? /^[0-9]+/u.exec(rest)
        ?? /^"[^"]*"?/u.exec(rest)
        ?? /^%[A-Za-z]?/u.exec(rest);
      let kind: CfgTokenKind;
      let length: number;
      if (match) {
        const first = match[0][0]!;
        kind = first === '"' ? 'string' : first === '%' ? 'percent' : first === '$' || /[0-9]/u.test(first) ? 'number' : 'identifier';
        length = match[0].length;
      } else {
        kind = '{}:;,=+-*/()'.includes(char) ? 'punctuation' : 'invalid';
        length = 1;
      }
      tokens.push({kind, text: source.slice(at, at + length), line, start: at, end: at + length});
      at += length;
    }
  });
  return {lines, tokens};
}

export const tokenSpan = (token: CfgToken): Span => ({line: token.line, start: token.start, end: token.end});

/** The value of a number token, or undefined for a malformed one. */
export function cfgNumber(text: string): number | undefined {
  if (/^\$[0-9A-Fa-f]+$/u.test(text)) return parseInt(text.slice(1), 16);
  if (/^[0-9]+$/u.test(text)) return Number(text);
  return undefined;
}

// --- Parsing -----------------------------------------------------------------

/** Parse a configuration, reporting what ld65 would refuse. Never throws. */
export function parseConfig(text: string): ParsedConfig {
  const {lines, tokens} = tokenizeConfig(text);
  const problems: CfgProblem[] = [];
  const blocks: CfgBlock[] = [];
  let index = 0;
  const peek = (offset = 0) => tokens[index + offset];
  const error = (token: CfgToken | undefined, message: string) => {
    const at = token ?? tokens.at(-1);
    const span = at ? tokenSpan(at) : {line: 0, start: 0, end: 0};
    problems.push({span: token ? span : {line: span.line, start: span.end, end: span.end}, message, severity: 'error'});
  };
  const is = (token: CfgToken | undefined, text: string) => token?.kind === 'punctuation' && token.text === text;

  for (const token of tokens) {
    if (token.kind === 'invalid') error(token, `ld65 does not accept '${token.text}' here`);
    if (token.kind === 'string' && !token.text.endsWith('"') || token.kind === 'string' && token.text.length < 2) error(token, 'The string is not closed with "');
    if (token.kind === 'number' && cfgNumber(token.text) === undefined) error(token, 'A hex number needs digits after $');
    if (token.kind === 'percent' && !['%O', '%S'].includes(token.text)) error(token, `ld65 knows only %O (the output file) and %S (the start address), not ${token.text}`);
  }

  while (index < tokens.length) {
    const head = tokens[index]!;
    if (head.kind !== 'identifier') {
      error(head, 'A block name (MEMORY, FILES, SEGMENTS, FEATURES, SYMBOLS or FORMATS) was expected');
      index += 1;
      continue;
    }
    const key = head.text.toUpperCase();
    const spec = blockSpec(key);
    if (!spec) error(head, `${head.text} is not an ld65 block; the blocks are MEMORY, FILES, SEGMENTS, FEATURES, SYMBOLS and FORMATS`);
    index += 1;
    if (!is(peek(), '{')) {
      error(peek(), `'{' expected after ${head.text}`);
      // Skip to the next thing that looks like a block.
      while (index < tokens.length && !(tokens[index]!.kind === 'identifier' && is(tokens[index + 1], '{'))) index += 1;
      continue;
    }
    const block: CfgBlock = {name: head.text, key, span: tokenSpan(head), items: [], openLine: peek()!.line, closeLine: lines.length - 1};
    blocks.push(block);
    index += 1;
    for (;;) {
      const token = peek();
      if (!token) { error(undefined, `'}' expected to close ${head.text}`); break; }
      if (is(token, '}')) {
        block.closeLine = token.line;
        block.close = {line: token.line, character: token.end};
        index += 1;
        break;
      }
      // A block name followed by '{' means this block was not closed.
      if (token.kind === 'identifier' && is(peek(1), '{')) { error(token, `'}' expected to close ${head.text} before ${token.text}`); break; }
      parseItem(block);
    }
  }

  function parseItem(block: CfgBlock): void {
    const name = peek()!;
    const validName = name.kind === 'identifier' || (block.key === 'FILES' && (name.kind === 'string' || name.kind === 'percent'));
    if (!validName) {
      error(name, block.key === 'FILES' ? 'A file name (%O or "name") was expected' : 'A name was expected');
      skipItem();
      return;
    }
    index += 1;
    const item: CfgItem = {
      name: name.kind === 'string' ? name.text.replace(/^"|"$/gu, '') : name.text,
      nameKind: name.kind as CfgItem['nameKind'], span: tokenSpan(name), attributes: [], endLine: name.line,
    };
    block.items.push(item);
    if (!is(peek(), ':')) {
      error(peek() ?? name, `':' expected after ${name.text}`);
      skipItem();
      return;
    }
    index += 1;
    for (;;) {
      const token = peek();
      if (!token || is(token, '}')) { error(token ?? tokens.at(-1), `';' expected after ${item.name}'s attributes`); return; }
      if (is(token, ';')) { item.endLine = token.line; index += 1; return; }
      if (is(token, ',')) { index += 1; continue; }
      if (token.kind !== 'identifier') {
        error(token, `An attribute was expected, got '${token.text}'`);
        skipItem();
        return;
      }
      index += 1;
      const attribute: CfgAttribute = {name: token.text, key: token.text.toLowerCase(), span: tokenSpan(token)};
      item.attributes.push(attribute);
      item.endLine = token.line;
      if (!is(peek(), '=')) {
        error(peek() ?? token, `'=' expected after ${token.text}`);
        skipItem();
        return;
      }
      index += 1;
      const valueTokens: CfgToken[] = [];
      while (index < tokens.length) {
        const next = tokens[index]!;
        if (is(next, ',') || is(next, ';') || is(next, '}') || is(next, '{')) break;
        // Commas between attributes are optional: `name =` starts the next one.
        if (valueTokens.length && next.kind === 'identifier' && is(tokens[index + 1], '=')) break;
        valueTokens.push(next);
        index += 1;
      }
      if (!valueTokens.length) {
        error(peek() ?? token, `A value was expected for ${token.text}`);
        continue;
      }
      const first = valueTokens[0]!, last = valueTokens.at(-1)!;
      attribute.value = {
        tokens: valueTokens, text: valueTokens.map(item => item.text).join(' '),
        span: {line: first.line, start: first.start, end: first.line === last.line ? last.end : lines[first.line]!.length},
      };
      item.endLine = last.line;
    }
  }

  function skipItem(): void {
    while (index < tokens.length && !is(tokens[index], ';') && !is(tokens[index], '}')) index += 1;
    if (is(tokens[index], ';')) index += 1;
  }

  return {lines, tokens, blocks, problems};
}

// --- Expressions -------------------------------------------------------------

export interface CfgEvaluation {
  value?: number;
  /** A syntax error in the expression. */
  error?: {token?: CfgToken; message: string};
  /** Symbols the expression uses. */
  symbols: CfgToken[];
}

/**
 * Evaluate an ld65 expression: numbers, symbols, `%S`, unary and binary
 * `+ - * /` and parentheses (ld65 has no other operators). `value` is
 * undefined when a symbol is unknown, so the result is not constant here.
 */
export function evaluateConfigExpression(tokens: CfgToken[], lookup: (name: string) => number | undefined, startAddress = 0x200): CfgEvaluation {
  let index = 0;
  const symbols: CfgToken[] = [];
  let failure: CfgEvaluation['error'];
  const fail = (token: CfgToken | undefined, message: string) => { failure ??= {...(token ? {token} : {}), message}; return undefined; };
  const op = (text: string) => tokens[index]?.kind === 'punctuation' && tokens[index]!.text === text;

  function primary(): number | undefined {
    const token = tokens[index];
    if (!token) return fail(undefined, 'The expression ends too early');
    if (op('-') || op('+')) {
      index += 1;
      const value = primary();
      return value === undefined ? undefined : token.text === '-' ? -value : value;
    }
    if (op('(')) {
      index += 1;
      const value = sum();
      if (!op(')')) return fail(tokens[index], "')' expected");
      index += 1;
      return value;
    }
    index += 1;
    if (token.kind === 'number') return cfgNumber(token.text);
    if (token.kind === 'percent' && token.text === '%S') return startAddress;
    if (token.kind === 'identifier') {
      symbols.push(token);
      return lookup(token.text);
    }
    return fail(token, `ld65 expressions have numbers, symbols, + - * / and parentheses; '${token.text}' is not allowed`);
  }
  function product(): number | undefined {
    let value = primary();
    while (op('*') || op('/')) {
      const operator = tokens[index]!;
      index += 1;
      const right = primary();
      if (operator.text === '/' && right === 0) return fail(operator, 'Division by zero');
      value = value === undefined || right === undefined ? undefined : operator.text === '*' ? value * right : Math.trunc(value / right);
    }
    return value;
  }
  function sum(): number | undefined {
    let value = product();
    while (op('+') || op('-')) {
      const operator = tokens[index]!.text;
      index += 1;
      const right = product();
      value = value === undefined || right === undefined ? undefined : operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const value = sum();
  if (index < tokens.length) fail(tokens[index], `Unexpected '${tokens[index]!.text}' in the expression`);
  return failure ? {error: failure, symbols} : {...(value !== undefined ? {value} : {}), symbols};
}

/** Symbols the configuration defines (SYMBOLS export and weak), for expressions. */
export function configSymbols(config: ParsedConfig): Map<string, {item: CfgItem; tokens?: CfgToken[]}> {
  const out = new Map<string, {item: CfgItem; tokens?: CfgToken[]}>();
  for (const block of config.blocks) {
    if (block.key !== 'SYMBOLS') continue;
    for (const item of block.items) {
      const value = item.attributes.find(attribute => attribute.key === 'value')?.value;
      out.set(item.name, {item, ...(value ? {tokens: value.tokens} : {})});
    }
  }
  return out;
}

/** The value of `%S`: FEATURES STARTADDRESS default, else ld65's $0200. */
export function startAddressOf(config: ParsedConfig): number {
  for (const block of config.blocks) {
    if (block.key !== 'FEATURES') continue;
    for (const item of block.items) {
      if (item.name.toUpperCase() !== 'STARTADDRESS') continue;
      const value = item.attributes.find(attribute => attribute.key === 'default')?.value;
      const result = value && evaluateConfigExpression(value.tokens.filter(token => token.text !== '%S'), () => undefined);
      if (result?.value !== undefined) return result.value;
    }
  }
  return 0x200;
}

/** An evaluator for this configuration's expressions, following its SYMBOLS (cycles give undefined). */
export function configEvaluator(config: ParsedConfig): (tokens: CfgToken[]) => CfgEvaluation {
  const symbols = configSymbols(config);
  const start = startAddressOf(config);
  const resolving = new Set<string>();
  const cache = new Map<string, number | undefined>();
  const lookup = (name: string): number | undefined => {
    if (cache.has(name)) return cache.get(name);
    const symbol = symbols.get(name);
    if (!symbol?.tokens || resolving.has(name)) return undefined;
    resolving.add(name);
    const value = evaluateConfigExpression(symbol.tokens, lookup, start).value;
    resolving.delete(name);
    cache.set(name, value);
    return value;
  };
  return tokens => evaluateConfigExpression(tokens, lookup, start);
}
