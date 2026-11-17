/**
 * A line-based reader of ca65 source. It is not an assembler: it finds what an
 * editor needs (definitions, references, scopes, includes and blocks) and
 * leaves checking to ca65 itself (see diagnostics.ts). Positions are zero-based
 * lines and characters, like LSP's.
 */
import {numberValue} from './expression.js';
import {packMacroFor} from './macpacks.js';
import {instructionFor} from './opcodes.js';

/** Bytes a structure field's storage takes, when it is a plain size. */
function storageSize(storage: string): number | undefined {
  const match = /^\.(\w+)\s*(.*)$/u.exec(storage.trim());
  if (!match) return undefined;
  const count = match[2] ? numberValue(match[2].trim()) : 1;
  if (count === undefined) return undefined;
  const size = ({byte: 1, byt: 1, res: 1, word: 2, addr: 2, dbyt: 2, faraddr: 3, dword: 4} as Record<string, number>)[match[1]!.toLowerCase()];
  return size === undefined ? undefined : size * count;
}

export interface Span {
  line: number;
  start: number;
  end: number;
}

export type AsmSymbolKind =
  | 'label' | 'local' | 'constant' | 'variable' | 'macro' | 'define'
  | 'proc' | 'scope' | 'struct' | 'union' | 'enum' | 'member' | 'import';

export interface AsmSymbol {
  name: string;
  kind: AsmSymbolKind;
  /** Where the name is written. */
  span: Span;
  /** The enclosing scope path, `''` at the top level, else e.g. `main::loop`. */
  scope: string;
  /** For a cheap local (`@name`), the normal label it follows. */
  cheapScope?: number;
  /** Last line of a block symbol (proc, scope, struct, union, enum, macro). */
  endLine?: number;
  /** Source text of the value of a constant, variable, member or define. */
  value?: string;
  /** Comment lines just above the definition, and the comment after it. */
  doc?: string;
  /** Macro parameters. */
  params?: string[];
  /** True when declared with a zero-page directive or in a zero-page segment. */
  zeroPage?: boolean;
  /** A structure field's offset, or an enumeration member's implicit value. */
  offset?: number;
  /** For an import: `.import`, `.importzp`, `.global` or `.globalzp`. */
  via?: string;
}

export interface AsmReference {
  /** The name as written: `foo`, `@loop`, `scope::foo` or `::foo`. */
  name: string;
  span: Span;
  scope: string;
  cheapScope: number;
}

export interface UnnamedReference {
  span: Span;
  /** Positive: the nth unnamed label after this line; negative: before. */
  offset: number;
}

export interface Include {
  path: string;
  /** Span of the path, inside the quotes. */
  span: Span;
  binary: boolean;
}

/** One source line, split into its parts. */
export interface Statement {
  line: number;
  /** The instruction, macro call or directive word, if any. */
  word?: {text: string; start: number; end: number};
  /** Text after the word, without the comment, and where it starts. */
  operand?: {text: string; start: number};
  /** True inside a `.macro` body. */
  inMacro: boolean;
  /** The scope path at this line. */
  scope: string;
  cheapScope: number;
}

export interface Fold {
  start: number;
  end: number;
  kind?: 'comment';
}

export interface ParsedFile {
  lines: string[];
  symbols: AsmSymbol[];
  references: AsmReference[];
  unnamedLabels: number[];
  unnamedReferences: UnnamedReference[];
  includes: Include[];
  /** Names this file makes visible to other modules (`.export`, `.global`). */
  exports: Set<string>;
  statements: Statement[];
  folds: Fold[];
  /** Spans of directive and pseudo-function words, for hover. */
  directives: Array<Span & {name: string}>;
  segments: Array<{name: string; line: number}>;
  /** ca65 macro packages loaded with `.macpack`. */
  macpacks: string[];
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/uy;
const blockKinds: Record<string, AsmSymbolKind | 'anonymous'> = {
  '.proc': 'proc', '.scope': 'scope', '.struct': 'struct', '.union': 'union', '.enum': 'enum',
};
const blockEnds = new Set(['.endproc', '.endscope', '.endstruct', '.endunion', '.endenum']);
const conditionalStarts = /^\.if/u;
const zeroPageSegments = new Set(['zeropage', 'zp']);

/** Split text into lines, accepting LF, CRLF and CR. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/u);
}

/** The index where a line's comment starts, ignoring `;` inside strings and character constants. */
export function commentStart(line: string): number {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"') {
      quote = char;
    } else if (char === "'" && line[index + 2] === "'") {
      index += 2;
    } else if (char === ';') {
      return index;
    }
  }
  return -1;
}

export interface Token {
  kind: 'identifier' | 'local' | 'directive' | 'number' | 'string' | 'char' | 'unnamed' | 'operator';
  text: string;
  start: number;
  end: number;
}

/** Tokenize the code part of a line from `from` to `to`. */
export function tokenize(line: string, from = 0, to = line.length): Token[] {
  const tokens: Token[] = [];
  let index = from;
  const push = (kind: Token['kind'], end: number) => {
    tokens.push({kind, text: line.slice(index, end), start: index, end});
    index = end;
  };
  while (index < to) {
    const char = line[index]!;
    if (/\s/u.test(char)) { index += 1; continue; }
    if (char === '"') {
      let end = index + 1;
      while (end < to && line[end] !== '"') end += line[end] === '\\' ? 2 : 1;
      push('string', Math.min(end + 1, to));
      continue;
    }
    if (char === "'" && line[index + 2] === "'") { push('char', index + 3); continue; }
    if (char === '$' && /[0-9A-Fa-f]/u.test(line[index + 1] ?? '')) {
      let end = index + 1;
      while (end < to && /[0-9A-Fa-f]/u.test(line[end]!)) end += 1;
      push('number', end);
      continue;
    }
    if (char === '%' && /[01]/u.test(line[index + 1] ?? '') && !/[\w)]/u.test(line[index - 1] ?? '')) {
      let end = index + 1;
      while (end < to && /[01]/u.test(line[end]!)) end += 1;
      push('number', end);
      continue;
    }
    if (/[0-9]/u.test(char)) {
      let end = index;
      while (end < to && /[0-9A-Za-z]/u.test(line[end]!)) end += 1;
      push('number', end);
      continue;
    }
    if (char === '@' && /[A-Za-z0-9_]/u.test(line[index + 1] ?? '')) {
      let end = index + 1;
      while (end < to && /[A-Za-z0-9_]/u.test(line[end]!)) end += 1;
      push('local', end);
      continue;
    }
    if (char === '.' && /[A-Za-z]/u.test(line[index + 1] ?? '')) {
      let end = index + 1;
      while (end < to && /[A-Za-z0-9_]/u.test(line[end]!)) end += 1;
      push('directive', end);
      continue;
    }
    if (/[A-Za-z_]/u.test(char) || (char === ':' && line[index + 1] === ':' && /[A-Za-z_]/u.test(line[index + 2] ?? ''))) {
      let end = index;
      for (;;) {
        if (line.startsWith('::', end)) end += 2;
        IDENT.lastIndex = end;
        const match = IDENT.exec(line);
        if (!match || end >= to) break;
        end += match[0].length;
        if (!(line.startsWith('::', end) && /[A-Za-z_]/u.test(line[end + 2] ?? ''))) break;
      }
      push('identifier', Math.min(end, to));
      continue;
    }
    if (char === ':' && /[+-]/u.test(line[index + 1] ?? '')) {
      let end = index + 1;
      const sign = line[end];
      while (end < to && line[end] === sign) end += 1;
      push('unnamed', end);
      continue;
    }
    push('operator', index + 1);
  }
  return tokens;
}

/** Comment text of the contiguous comment-only lines just above `line`. */
function leadingComment(lines: string[], line: number): string[] {
  const out: string[] = [];
  for (let index = line - 1; index >= 0; index -= 1) {
    const text = lines[index]!.trim();
    if (!text.startsWith(';')) break;
    out.unshift(text.replace(/^;+ ?/u, ''));
  }
  // A divider line (---- or ====) above a section is not documentation.
  while (out.length && /^[-=*#~ ]*$/u.test(out[0]!)) out.shift();
  const divider = out.findIndex(text => /^[-=]{4,}$/u.test(text));
  return divider >= 0 ? out.slice(divider + 1) : out;
}

/** Documentation for a definition on `line`: comments above it and the comment after it. */
function docFor(lines: string[], line: number): string | undefined {
  const above = leadingComment(lines, line);
  const text = lines[line]!;
  const start = commentStart(text);
  const trailing = start >= 0 && text.slice(0, start).trim() ? text.slice(start).replace(/^;+ ?/u, '').trim() : '';
  const parts = [above.join('\n').trim(), trailing].filter(Boolean);
  return parts.length ? parts.join('\n\n') : undefined;
}

const joinScope = (scope: string, name: string): string => (scope ? `${scope}::${name}` : name);

/** Read a ca65 source file. */
export function parseAsm(text: string): ParsedFile {
  const lines = splitLines(text);
  const file: ParsedFile = {
    lines, symbols: [], references: [], unnamedLabels: [], unnamedReferences: [], includes: [], exports: new Set(),
    statements: [], folds: [], directives: [], segments: [], macpacks: [],
  };
  const scopes: Array<{name: string; kind: AsmSymbolKind | 'anonymous'; symbol?: AsmSymbol; start: number; offset?: number}> = [];
  const blocks: Array<{directive: string; start: number}> = [];
  let anonymous = 0;
  let cheapScope = 0;
  let macro: {symbol: AsmSymbol; hidden: Set<string>} | undefined;
  let segmentZeroPage = false;
  let commentRun: number | undefined;

  const scopePath = () => scopes.map(item => item.name).join('::');
  const inRecord = () => {
    const kind = scopes.at(-1)?.kind;
    return kind === 'struct' || kind === 'union' || kind === 'enum';
  };
  const add = (symbol: AsmSymbol) => {
    file.symbols.push(symbol);
    return symbol;
  };
  const reference = (token: Token, line: number) => {
    if (token.kind === 'unnamed') {
      const count = token.text.length - 1;
      file.unnamedReferences.push({span: {line, start: token.start, end: token.end}, offset: token.text[1] === '+' ? count : -count});
      return;
    }
    if (token.kind === 'directive') {
      file.directives.push({line, start: token.start, end: token.end, name: token.text.toLowerCase()});
      return;
    }
    if (token.kind !== 'identifier' && token.kind !== 'local') return;
    if (macro && macro.hidden.has(token.text)) return;
    file.references.push({name: token.text, span: {line, start: token.start, end: token.end}, scope: scopePath(), cheapScope});
  };
  /** Record operand tokens as references, leaving out registers after a comma and `a` alone. */
  const operandReferences = (tokens: Token[], line: number) => {
    tokens.forEach((token, index) => {
      if (token.kind === 'identifier' && /^[xyas]$/iu.test(token.text)) {
        const previous = tokens[index - 1];
        if (previous?.text === ',' || tokens.length === 1) return;
      }
      reference(token, line);
    });
  };

  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line]!;
    const comment = commentStart(raw);
    const codeEnd = comment >= 0 ? comment : raw.length;
    const code = raw.slice(0, codeEnd);

    if (!code.trim() && comment >= 0) {
      commentRun ??= line;
    } else {
      if (commentRun !== undefined && line - commentRun >= 3) file.folds.push({start: commentRun, end: line - 1, kind: 'comment'});
      commentRun = undefined;
    }

    let tokens = tokenize(raw, 0, codeEnd);
    if (!tokens.length) continue;

    // Labels: `name:`, `@name:`, `name::` is a scope reference, not a label. A bare `:` is unnamed.
    if (tokens[0]!.kind === 'operator' && tokens[0]!.text === ':') {
      if (!macro) file.unnamedLabels.push(line);
      tokens = tokens.slice(1);
    } else if ((tokens[0]!.kind === 'identifier' || tokens[0]!.kind === 'local') && tokens[1]?.text === ':' && tokens[1].start === tokens[0]!.end
      && !tokens[0]!.text.includes('::') && !(tokens[2]?.text === '=' && tokens[2].start === tokens[1].end)) {
      const token = tokens[0]!;
      if (macro) {
        macro.hidden.add(token.text);
      } else {
        const local = token.kind === 'local';
        if (!local) cheapScope += 1;
        add({
          name: token.text, kind: local ? 'local' : 'label', span: {line, start: token.start, end: token.end}, scope: scopePath(),
          ...(local ? {cheapScope} : {}), ...(segmentZeroPage ? {zeroPage: true} : {}), doc: docFor(lines, line),
        });
      }
      tokens = tokens.slice(2);
    }
    if (!tokens.length) continue;

    const first = tokens[0]!;
    const second = tokens[1];
    // name = expr, name := expr, name .set expr
    if ((first.kind === 'identifier' || first.kind === 'local') && second && (second.text === '=' || (second.text === ':' && tokens[2]?.text === '=' && tokens[2].start === second.end)
      || (second.kind === 'directive' && second.text.toLowerCase() === '.set'))) {
      const valueToken = second.text === ':' ? tokens[3] : tokens[2];
      const value = valueToken ? code.slice(valueToken.start).trim() : '';
      if (macro) {
        macro.hidden.add(first.text);
      } else {
        const kind: AsmSymbolKind = second.kind === 'directive' ? 'variable' : inRecord() ? 'member' : 'constant';
        const existing = kind === 'variable' ? file.symbols.find(item => item.kind === 'variable' && item.name === first.text && item.scope === scopePath()) : undefined;
        if (existing) reference(first, line);
        else add({name: first.text, kind, span: {line, start: first.start, end: first.end}, scope: scopePath(), value, doc: docFor(lines, line)});
        // An enumeration counts on from an explicit number.
        if (kind === 'member' && scopes.at(-1)!.kind === 'enum') {
          const number = numberValue(value);
          scopes.at(-1)!.offset = number === undefined ? undefined : number + 1;
        }
      }
      operandReferences(tokens.slice(second.text === ':' ? 3 : 2), line);
      file.statements.push({line, inMacro: Boolean(macro), scope: scopePath(), cheapScope});
      continue;
    }

    // Lines of a .struct, .union or .enum: `field .byte`, `field .res 2`, `MEMBER`, `MEMBER = 3`.
    if (inRecord() && first.kind === 'identifier' && !macro) {
      const kind = scopes.at(-1)!.kind;
      const storage = second?.kind === 'directive' ? code.slice(second.start).trim() : undefined;
      if (kind === 'enum' || storage) {
        const record = scopes.at(-1)!;
        const offset = record.offset;
        if (kind === 'enum') record.offset = offset === undefined ? undefined : offset + 1;
        else if (kind === 'struct' && offset !== undefined) record.offset = storageSize(storage!) === undefined ? undefined : offset + storageSize(storage!)!;
        add({
          name: first.text, kind: 'member', span: {line, start: first.start, end: first.end}, scope: scopePath(), ...(storage ? {value: storage} : {}),
          ...(offset === undefined ? {} : {offset}), doc: docFor(lines, line),
        });
        if (second) operandReferences(tokens.slice(2), line);
        continue;
      }
    }

    const word = {text: first.text, start: first.start, end: first.end};
    const operandStart = second?.start ?? first.end;
    const statement: Statement = {
      line, word, operand: {text: code.slice(operandStart), start: operandStart}, inMacro: Boolean(macro), scope: scopePath(), cheapScope,
    };
    file.statements.push(statement);
    const rest = tokens.slice(1);

    if (first.kind !== 'directive') {
      // An instruction or a macro call: the word itself is a reference unless it is a mnemonic.
      if (first.kind === 'identifier' && !instructionFor(first.text) && !packMacroFor(first.text, file.macpacks)) reference(first, line);
      operandReferences(rest, line);
      continue;
    }

    const directive = first.text.toLowerCase();
    file.directives.push({line, start: first.start, end: first.end, name: directive});

    if (macro) {
      if (directive === '.endmacro' || directive === '.endmac') {
        macro.symbol.endLine = line;
        file.folds.push({start: macro.symbol.span.line, end: line});
        macro = undefined;
      } else if (directive === '.local') {
        for (const token of rest) if (token.kind === 'identifier') macro.hidden.add(token.text);
      } else {
        operandReferences(rest, line);
      }
      continue;
    }

    if (directive === '.macro' || directive === '.mac') {
      const name = rest[0];
      if (name?.kind === 'identifier') {
        const params = rest.slice(1).filter(token => token.kind === 'identifier').map(token => token.text);
        const symbol = add({name: name.text, kind: 'macro', span: {line, start: name.start, end: name.end}, scope: scopePath(), params, doc: docFor(lines, line)});
        macro = {symbol, hidden: new Set(params)};
      }
      continue;
    }
    if (directive === '.define') {
      const name = rest[0];
      if (name?.kind === 'identifier') {
        const after = code.slice(name.end);
        const params = after.startsWith('(') ? after.slice(1, after.indexOf(')')).split(',').map(item => item.trim()).filter(Boolean) : undefined;
        const value = (params ? after.slice(after.indexOf(')') + 1) : after).trim();
        add({name: name.text, kind: 'define', span: {line, start: name.start, end: name.end}, scope: scopePath(), value, ...(params ? {params} : {}), doc: docFor(lines, line)});
      }
      continue;
    }
    if (directive in blockKinds) {
      const name = rest[0]?.kind === 'identifier' ? rest[0] : undefined;
      const kind = blockKinds[directive]!;
      if (name) {
        if (kind === 'proc') cheapScope += 1;
        const symbol = add({name: name.text, kind: kind as AsmSymbolKind, span: {line, start: name.start, end: name.end}, scope: scopePath(), doc: docFor(lines, line), ...(segmentZeroPage ? {zeroPage: true} : {})});
        scopes.push({name: name.text, kind: kind as AsmSymbolKind, symbol, start: line, offset: 0});
      } else {
        anonymous += 1;
        scopes.push({name: `<anonymous ${anonymous}>`, kind: kind === 'enum' || kind === 'struct' || kind === 'union' ? kind : 'anonymous', start: line, offset: 0});
      }
      continue;
    }
    if (blockEnds.has(directive)) {
      const scope = scopes.pop();
      if (scope) {
        if (scope.symbol) scope.symbol.endLine = line;
        file.folds.push({start: scope.start, end: line});
      }
      continue;
    }
    if (conditionalStarts.test(directive) || directive === '.repeat') {
      blocks.push({directive, start: line});
      operandReferences(rest, line);
      continue;
    }
    if (directive === '.endif' || directive === '.endrepeat' || directive === '.endrep') {
      const block = blocks.pop();
      if (block) file.folds.push({start: block.start, end: line});
      continue;
    }
    if (directive === '.include' || directive === '.incbin') {
      const path = rest.find(token => token.kind === 'string');
      if (path) {
        file.includes.push({path: path.text.slice(1, -1), span: {line, start: path.start + 1, end: path.end - 1}, binary: directive === '.incbin'});
      }
      operandReferences(rest.filter(token => token !== path), line);
      continue;
    }
    if (['.import', '.importzp', '.global', '.globalzp', '.export', '.exportzp', '.forceimport'].includes(directive)) {
      const zero = directive.endsWith('zp');
      // `.export name := expr` defines and exports in one.
      if (directive.startsWith('.export') && rest[1]?.text === ':' && rest[2]?.text === '=') {
        add({name: rest[0]!.text, kind: 'constant', span: {line, start: rest[0]!.start, end: rest[0]!.end}, scope: scopePath(), value: code.slice(rest[3]?.start ?? code.length).trim(), doc: docFor(lines, line)});
        file.exports.add(rest[0]!.text);
        operandReferences(rest.slice(3), line);
        continue;
      }
      for (const [index, token] of rest.entries()) {
        if (token.kind !== 'identifier' || (index > 0 && rest[index - 1]!.text !== ',')) continue;
        if (directive.startsWith('.export') || directive.startsWith('.global')) file.exports.add(token.text);
        if (directive.startsWith('.import') || directive.startsWith('.global') || directive === '.forceimport') {
          add({name: token.text, kind: 'import', span: {line, start: token.start, end: token.end}, scope: scopePath(), via: directive, ...(zero ? {zeroPage: true} : {}), doc: docFor(lines, line)});
        } else {
          reference(token, line);
        }
      }
      continue;
    }
    if (directive === '.segment') {
      const name = rest.find(token => token.kind === 'string')?.text.slice(1, -1);
      if (name !== undefined) {
        file.segments.push({name, line});
        segmentZeroPage = zeroPageSegments.has(name.toLowerCase()) || /:\s*zeropage/iu.test(code);
      }
      continue;
    }
    if (['.code', '.data', '.bss', '.rodata'].includes(directive)) {
      segmentZeroPage = false;
      file.segments.push({name: directive.slice(1).toUpperCase(), line});
      continue;
    }
    if (directive === '.macpack') {
      if (rest[0]?.kind === 'identifier') file.macpacks.push(rest[0].text.toLowerCase());
      continue;
    }
    if (directive === '.assert') {
      operandReferences(rest.filter(token => !/^(?:error|warning|lderror|ldwarning)$/iu.test(token.text)), line);
      continue;
    }
    if (directive === '.feature' || directive === '.setcpu' || directive === '.cpu') continue;
    if (directive === '.zeropage') {
      segmentZeroPage = true;
      file.segments.push({name: 'ZEROPAGE', line});
      continue;
    }
    operandReferences(rest, line);
  }
  if (commentRun !== undefined && lines.length - commentRun >= 3) file.folds.push({start: commentRun, end: lines.length - 1, kind: 'comment'});
  for (const symbol of file.symbols) {
    // A symbol declared `.globalzp` in this file and defined here is zero page too.
    if (symbol.kind !== 'import' && file.symbols.some(item => item.kind === 'import' && item.zeroPage && item.name === symbol.name)) symbol.zeroPage = true;
  }
  return file;
}

/** The full scope path a symbol is reached by, e.g. `main::loop`. */
export function qualifiedName(symbol: AsmSymbol): string {
  return joinScope(symbol.scope, symbol.name);
}
