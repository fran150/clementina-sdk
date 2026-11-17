/**
 * Editor features over an AsmWorkspace: hover text, completion, signature
 * help and the outline. They return plain data that server.ts turns into LSP
 * messages, so tests can call them directly.
 */
import {basename} from 'node:path';
import {caDirectives, directiveFor, type Directive} from './directives.js';
import {evaluate, formatValue, numberValue} from './expression.js';
import {packMacroFor, packMacros} from './macpacks.js';
import {addressingModeSyntax, instructionFor, instructions, type AddressingMode, type Instruction} from './opcodes.js';
import {commentStart, qualifiedName, tokenize, type AsmSymbol, type AsmSymbolKind, type Span, type Statement} from './parser.js';
import type {AsmWorkspace, Target} from './workspace.js';

const hex2 = (value: number) => `$${value.toString(16).toUpperCase().padStart(2, '0')}`;
const contains = (span: {start: number; end: number}, character: number) => character >= span.start && character <= span.end;

/** Names the Clementina library keeps to itself: `cl__*` helpers and `*_INC` include guards. */
export const isInternalName = (name: string) => name.startsWith('cl__') || /_INC$/u.test(name);

const kindLabels: Record<AsmSymbolKind, string> = {
  label: 'label', local: 'cheap local label', constant: 'constant', variable: 'variable (.set)', macro: 'macro', define: '.define macro',
  proc: 'procedure (.proc)', scope: 'scope', struct: 'structure', union: 'union', enum: 'enumeration', member: 'member', import: 'import',
};

/** The ca65 macro packages a file loads, itself or through its includes. */
function packsOf(workspace: AsmWorkspace, path: string): string[] {
  return workspace.visibleFiles(path).flatMap(file => file.parsed.macpacks);
}

/** The statement on a line, if any. */
export function statementAt(workspace: AsmWorkspace, path: string, line: number): Statement | undefined {
  return workspace.get(path)?.parsed.statements.find(item => item.line === line);
}

/** The addressing mode an instruction's operand uses, as ca65 would choose it. */
export function addressingModeOf(instruction: Instruction, operand: string, value: (expression: string) => {value?: number; zeroPage?: boolean}): AddressingMode | undefined {
  const has = (mode: AddressingMode) => instruction.modes.some(item => item.mode === mode);
  const text = operand.trim();
  if (!text) return has('implied') ? 'implied' : has('accumulator') ? 'accumulator' : undefined;
  if (/^a$/iu.test(text)) return has('accumulator') ? 'accumulator' : undefined;
  if (has('zeroPageRelative')) return 'zeroPageRelative';
  if (has('relative')) return 'relative';
  if (text.startsWith('#')) return has('immediate') ? 'immediate' : undefined;
  let match = /^\((.*),\s*x\s*\)$/iu.exec(text);
  if (match) return has('indexedIndirect') ? 'indexedIndirect' : has('absoluteIndexedIndirect') ? 'absoluteIndexedIndirect' : undefined;
  match = /^\((.*)\)\s*,\s*y$/iu.exec(text);
  if (match) return has('indirectIndexed') ? 'indirectIndexed' : undefined;
  if (/^\(.*\)$/u.test(text) && balanced(text.slice(1, -1))) return has('zeroPageIndirect') ? 'zeroPageIndirect' : has('indirect') ? 'indirect' : undefined;
  match = /^(.*?),\s*([xy])$/iu.exec(text);
  const index = match ? match[2]!.toUpperCase() as 'X' | 'Y' : '';
  let expression = match ? match[1]!.trim() : text;
  let forced: 'zp' | 'abs' | undefined;
  const prefix = /^([za]):\s*/iu.exec(expression);
  if (prefix) {
    forced = prefix[1]!.toLowerCase() === 'z' ? 'zp' : 'abs';
    expression = expression.slice(prefix[0].length);
  }
  const zeroPageMode = `zeroPage${index}` as AddressingMode;
  const absoluteMode = `absolute${index}` as AddressingMode;
  if (forced === 'abs') return has(absoluteMode) ? absoluteMode : undefined;
  const known = value(expression);
  const zeroPage = forced === 'zp' || known.zeroPage || (known.value !== undefined && known.value >= 0 && known.value <= 0xff);
  if (zeroPage && has(zeroPageMode)) return zeroPageMode;
  return has(absoluteMode) ? absoluteMode : has(zeroPageMode) ? zeroPageMode : undefined;
}

function balanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** What an operand expression is worth in a file's context. */
function operandValue(workspace: AsmWorkspace, path: string, statement: Statement, expression: string): {value?: number; zeroPage?: boolean} {
  let zeroPage = false;
  const value = evaluate(expression, name => {
    const target = workspace.resolve(path, {name, scope: statement.scope, cheapScope: statement.cheapScope});
    if (!target) return undefined;
    if (target.symbol.zeroPage) zeroPage = true;
    return workspace.valueOf(target);
  });
  return {...(value === undefined ? {} : {value}), zeroPage};
}

/** Markdown for an instruction, with the addressing mode a line uses marked. */
export function instructionHover(instruction: Instruction, mode?: AddressingMode): string {
  const rows = instruction.modes.map(item => {
    const {label, syntax} = addressingModeSyntax[item.mode];
    const cells = [label, syntax ? `\`${instruction.mnemonic} ${syntax}\`` : `\`${instruction.mnemonic}\``, hex2(item.opcode), String(item.bytes), item.cycles];
    return `| ${(item.mode === mode ? cells.map(cell => `**${cell}**`) : cells).join(' | ')} |`;
  });
  return [
    `**${instruction.mnemonic.toUpperCase()}** — ${instruction.name}`,
    instruction.summary,
    `Flags: ${instruction.flags || 'none'}`,
    ['| Mode | Syntax | Opcode | Bytes | Cycles |', '| --- | --- | --- | --- | --- |', ...rows].join('\n'),
    instruction.modes.some(item => item.cycles.endsWith('+')) ? '_+ one cycle more when a page is crossed; for a branch, when it is taken (and one more for a page)._' : '',
  ].filter(Boolean).join('\n\n');
}

export function directiveHover(directive: Directive): string {
  const kind = directive.kind === 'function' ? 'pseudo function' : directive.kind === 'variable' ? 'pseudo variable' : 'control command';
  return `**${directive.name}** — ca65 ${kind}\n\n\`${directive.syntax}\`\n\n${directive.summary}`;
}

/** Where a definition is, as `file:line`. */
const locationText = (target: Target) => `${basename(target.path)}:${target.symbol.span.line + 1}`;

/** The source line that defines a symbol, as a ca65 code block. */
function definitionLine(workspace: AsmWorkspace, target: Target): string {
  const text = workspace.get(target.path)?.parsed.lines[target.symbol.span.line] ?? '';
  const comment = commentStart(text);
  const code = (comment >= 0 ? text.slice(0, comment) : text).trim();
  return code ? `\`\`\`ca65\n${code}\n\`\`\`` : '';
}

export function symbolHover(workspace: AsmWorkspace, target: Target): string {
  const {symbol} = target;
  const library = workspace.get(target.path)?.library;
  const where = library ? `Clementina library, ${locationText(target)}` : locationText(target);
  const heading = `**${qualifiedName(symbol)}** — ${kindLabels[symbol.kind]}${symbol.zeroPage ? ', zero page' : ''} (${where})`;
  const parts = [heading, definitionLine(workspace, target)];
  const value = workspace.valueOf(target);
  if (value !== undefined) parts.push(`Value: ${formatValue(value)}`);
  if (symbol.kind === 'import') parts.push(`Declared with \`${symbol.via}\`; defined in another module.`);
  if (symbol.doc) parts.push(symbol.doc);
  return parts.filter(Boolean).join('\n\n');
}

/** Hover markdown at a position, or undefined. */
export function hoverAt(workspace: AsmWorkspace, path: string, line: number, character: number): {markdown: string; span: Span} | undefined {
  const file = workspace.get(path);
  if (!file) return undefined;
  const statement = statementAt(workspace, path, line);
  if (statement?.word && contains(statement.word, character)) {
    const instruction = instructionFor(statement.word.text);
    if (instruction) {
      const mode = addressingModeOf(instruction, statement.operand?.text ?? '', expression => operandValue(workspace, path, statement, expression));
      return {markdown: instructionHover(instruction, mode), span: {line, start: statement.word.start, end: statement.word.end}};
    }
  }
  if (statement?.word && contains(statement.word, character)) {
    const pack = packMacroFor(statement.word.text, packsOf(workspace, path));
    if (pack) return {markdown: `**${pack.name}** — macro from \`.macpack ${pack.pack}\`\n\n\`${pack.syntax}\`\n\n${pack.summary}`, span: {line, start: statement.word.start, end: statement.word.end}};
  }
  const directive = file.parsed.directives.find(item => item.line === line && contains(item, character));
  if (directive) {
    const entry = directiveFor(directive.name);
    if (entry) return {markdown: directiveHover(entry), span: directive};
  }
  const unnamed = workspace.unnamedTargetAt(path, line, character);
  if (unnamed) {
    const span = file.parsed.unnamedReferences.find(item => item.span.line === line && contains(item.span, character))!.span;
    return {markdown: `Unnamed label on line ${unnamed.span.line + 1}`, span};
  }
  const at = workspace.targetAt(path, line, character);
  if (at) return {markdown: symbolHover(workspace, at.target), span: at.span};
  const text = file.parsed.lines[line] ?? '';
  const comment = commentStart(text);
  const number = tokenize(text, 0, comment >= 0 ? comment : text.length).find(token => (token.kind === 'number' || token.kind === 'char') && contains(token, character));
  const value = number && numberValue(number.text);
  if (number && value !== undefined) return {markdown: `\`${number.text}\` = ${formatValue(value)}`, span: {line, start: number.start, end: number.end}};
  return undefined;
}

export type CompletionKind = 'instruction' | 'macro' | 'directive' | 'function' | AsmSymbolKind;

export interface Completion {
  label: string;
  kind: CompletionKind;
  detail: string;
  documentation?: string;
}

/** Where on a line the cursor is: the word position (instruction, macro or directive) or the operand. */
function completionContext(text: string, character: number): {position: 'word' | 'operand' | 'none'; prefix: string} {
  const comment = commentStart(text);
  if (comment >= 0 && character > comment) return {position: 'none', prefix: ''};
  const before = text.slice(0, character);
  const quotes = (before.match(/"/gu) ?? []).length;
  if (quotes % 2 === 1) return {position: 'none', prefix: ''};
  const prefix = /[.@]?[A-Za-z0-9_]*$/u.exec(before)![0];
  const head = before.slice(0, before.length - prefix.length);
  // Only a label (or nothing) before the word: `  `, `loop: `, `@x: `, `: `.
  if (/^\s*(?:(?:@?[A-Za-z_][A-Za-z0-9_]*)?:\s*)?$/u.test(head) && (head.trim() !== '' || /^\s/u.test(before) || prefix.startsWith('.'))) {
    return {position: 'word', prefix};
  }
  if (/^\s*$/u.test(head) && !/^\s/u.test(before)) return {position: 'none', prefix};
  return {position: 'operand', prefix};
}

const instructionCompletions = (): Completion[] => [...instructions.values()].map(item => ({
  label: item.mnemonic, kind: 'instruction', detail: item.name, documentation: instructionHover(item),
}));

const directiveCompletions = (kinds: Array<Directive['kind']>): Completion[] => [...caDirectives.values()]
  .filter(item => kinds.includes(item.kind))
  .map(item => ({label: item.name, kind: item.kind === 'directive' ? 'directive' : 'function', detail: item.syntax, documentation: directiveHover(item)}));

/** Completions at a position. */
export function completionsAt(workspace: AsmWorkspace, path: string, line: number, character: number): Completion[] {
  const file = workspace.get(path);
  if (!file) return [];
  const text = file.parsed.lines[line] ?? '';
  const context = completionContext(text, character);
  if (context.position === 'none') return [];
  const statement = file.parsed.statements.find(item => item.line === line);
  const cheapScope = statement?.cheapScope ?? [...file.parsed.symbols].reverse().find(item => item.span.line <= line && item.kind === 'label')?.cheapScope ?? 0;
  const scope = statement?.scope ?? '';
  const visible = new Set(workspace.visibleFiles(path).map(item => item.path));
  const seen = new Set<string>();
  const out: Completion[] = [];
  const push = (item: Completion) => {
    if (seen.has(item.label)) return;
    seen.add(item.label);
    out.push(item);
  };
  const symbolCompletion = (target: Target, label = target.symbol.name): Completion => ({
    label, kind: target.symbol.kind, detail: `${kindLabels[target.symbol.kind]} · ${locationText(target)}`, documentation: symbolHover(workspace, target),
  });

  if (context.prefix.startsWith('.')) {
    return directiveCompletions(context.position === 'word' ? ['directive'] : ['function', 'variable']);
  }
  if (context.prefix.startsWith('@')) {
    for (const symbol of file.parsed.symbols) if (symbol.kind === 'local' && symbol.cheapScope === cheapScope) push(symbolCompletion({path: file.path, symbol}));
    return out;
  }
  if (context.position === 'word') {
    out.push(...instructionCompletions());
    const packs = packsOf(workspace, path);
    for (const macro of packMacros.values()) {
      if (packs.includes(macro.pack)) push({label: macro.name, kind: 'macro', detail: `.macpack ${macro.pack}`, documentation: `\`${macro.syntax}\`\n\n${macro.summary}`});
    }
    for (const target of workspace.allSymbols()) {
      if (target.symbol.kind === 'macro' && !isInternalName(target.symbol.name) && (visible.has(target.path) || !workspace.get(target.path)?.library)) push(symbolCompletion(target));
    }
    return out;
  }
  // Operand: the current scope's names first, then everything a program can reach.
  for (const target of workspace.allSymbols()) {
    const {symbol} = target;
    if (symbol.kind === 'local' || symbol.kind === 'macro' || isInternalName(symbol.name)) continue;
    if (symbol.scope && target.path === file.path && (scope === symbol.scope || scope.startsWith(`${symbol.scope}::`))) push(symbolCompletion(target));
  }
  for (const target of workspace.allSymbols()) {
    const {symbol} = target;
    if (symbol.kind === 'local' || symbol.kind === 'macro' || isInternalName(symbol.name)) continue;
    const library = workspace.get(target.path)?.library;
    // Library sources are reached through clementina-lib.inc; offer only what it declares.
    if (library && !visible.has(target.path)) continue;
    if (symbol.scope === '') push(symbolCompletion(target));
    else if (symbol.kind === 'member' || symbol.kind === 'label') push(symbolCompletion(target, qualifiedName(symbol)));
  }
  return out;
}

export interface SignatureHelp {
  label: string;
  parameters: string[];
  activeParameter: number;
  documentation?: string;
}

/** Parameter help for a macro call (or a `.define` with parameters) at a position. */
export function signatureHelpAt(workspace: AsmWorkspace, path: string, line: number, character: number): SignatureHelp | undefined {
  const statement = statementAt(workspace, path, line);
  if (!statement?.word || !statement.operand || character < statement.word.end) return undefined;
  if (instructionFor(statement.word.text)) return undefined;
  const target = workspace.resolve(path, {name: statement.word.text, scope: statement.scope, cheapScope: statement.cheapScope});
  if (!target || target.symbol.kind !== 'macro' || !target.symbol.params) return undefined;
  const typed = (workspace.get(path)?.parsed.lines[line] ?? '').slice(statement.operand.start, character);
  const activeParameter = (typed.match(/,/gu) ?? []).length;
  const params = target.symbol.params;
  return {
    label: `${target.symbol.name} ${params.join(', ')}`.trim(), parameters: params, activeParameter,
    ...(target.symbol.doc ? {documentation: target.symbol.doc} : {}),
  };
}

export interface OutlineSymbol {
  name: string;
  kind: AsmSymbolKind;
  detail?: string;
  span: Span;
  endLine: number;
  children: OutlineSymbol[];
}

/** The outline of a file: procedures, scopes, structures and macros with what they contain. */
export function documentOutline(workspace: AsmWorkspace, path: string): OutlineSymbol[] {
  const file = workspace.get(path);
  if (!file) return [];
  const roots: OutlineSymbol[] = [];
  const byScope = new Map<string, OutlineSymbol[]>([['', roots]]);
  for (const symbol of file.parsed.symbols) {
    if (symbol.kind === 'import' || symbol.kind === 'local') continue;
    const node: OutlineSymbol = {
      name: symbol.name, kind: symbol.kind, span: symbol.span, endLine: symbol.endLine ?? symbol.span.line, children: [],
      ...(symbol.value ? {detail: symbol.value} : symbol.params ? {detail: symbol.params.join(', ')} : {}),
    };
    (byScope.get(symbol.scope) ?? roots).push(node);
    if (symbol.endLine !== undefined) byScope.set(qualifiedName(symbol), node.children);
  }
  return roots;
}

/**
 * Make ca65's messages clearer where it is terse: a word that is not an
 * instruction or macro gets "':' expected" (ca65 reads it as a label missing
 * its colon), usually with "Unexpected trailing garbage characters" after it.
 */
export function explainCa65<T extends {path: string; line: number; message: string}>(workspace: AsmWorkspace, messages: T[]): T[] {
  const out: T[] = [];
  const explained = new Set<string>();
  for (const message of messages) {
    const key = `${message.path}:${message.line}`;
    if (explained.has(key) && message.message === 'Unexpected trailing garbage characters') continue;
    if (message.message === "':' expected") {
      const statement = statementAt(workspace, message.path, message.line);
      const word = statement?.word?.text;
      if (word && !word.startsWith('.') && !instructionFor(word) && !packMacroFor(word, packsOf(workspace, message.path))) {
        const target = workspace.resolve(message.path, {name: word, scope: statement.scope, cheapScope: statement.cheapScope});
        if (!target || target.symbol.kind !== 'macro') {
          explained.add(key);
          out.push({...message, message: `${word} is not a 65C02 instruction or a macro defined here (ca65: ':' expected)`});
          continue;
        }
      }
    }
    out.push(message);
  }
  return out;
}
