import {
  BasicProgramError,
  basicTokenTables,
  basicSourceLimits,
  compileBasicProgram,
  detokenizeBasicProgram,
  parseBasicSource,
  tokenizeBasicLineWithSpans,
} from '@clementina/basic';
import {basicFunctionKeywords, basicSignatureByKeyword, basicStatementKeywords} from './catalog.js';
export * from './catalog.js';

export type BasicKeywordCategory = 'primary' | 'extension' | 'extension2' | 'extensionFunction' | 'special';

export interface BasicLspDiagnostic {
  /** 1-based physical source line, matching BasicProgramError.sourceLine. */
  line: number;
  message: string;
  code: 'basic.parse' | 'basic.compile' | 'basic.target' | 'basic.syntax';
  /** Zero-based source columns when the diagnostic covers a specific token. */
  startCharacter?: number;
  endCharacter?: number;
}

export interface BasicHoverInfo {
  keyword: string;
  category: BasicKeywordCategory;
  /** Hex byte(s), e.g. "$89" for a primary token or "$FF,$A0" for a prefixed one. */
  token: string;
}

export interface BasicCompletionItem {
  keyword: string;
  category: BasicKeywordCategory | 'variable';
}

export interface BasicDefinition {
  /** 1-based physical source line containing the effective target definition. */
  line: number;
  startCharacter: number;
  endCharacter: number;
}

export interface BasicSignatureHelp {
  label: string;
  parameters: string[];
  activeParameter: number;
}

export interface RenumberBasicOptions {
  start?: number;
  step?: number;
}

export interface BasicSourceLocation {
  line: number;
  startCharacter: number;
  endCharacter: number;
}

export interface BasicDocumentSymbol extends BasicSourceLocation {
  name: string;
  kind: 'line' | 'variable';
}

export interface BasicTextEdit extends BasicSourceLocation {newText: string}

export interface BasicSemanticSpan extends BasicSourceLocation {
  type: 'keyword' | 'number' | 'string' | 'comment' | 'variable' | 'operator';
}

function splitPhysicalLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').split('\n');
}

function isPrintableAscii(line: string): boolean {
  for (let index = 0; index < line.length; index++) {
    const code = line.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Collect every numbered-line format/length/range error in the document, plus
 * a whole-program size-overflow diagnostic, instead of stopping at the first
 * failure the way `parseBasicSource` does for interactive entry. Reuses the
 * canonical parser/compiler verbatim rather than re-deriving their rules.
 */
export function analyzeDiagnostics(text: string): BasicLspDiagnostic[] {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const lines = splitPhysicalLines(text);
  const blanked = new Set<number>();
  const diagnostics: BasicLspDiagnostic[] = [];
  let candidate = text;

  for (let attempt = 0; attempt <= lines.length; attempt++) {
    candidate = lines.map((line, index) => (blanked.has(index) ? '' : line)).join('\n');
    try {
      parseBasicSource(candidate);
      break;
    } catch (error) {
      if (!(error instanceof BasicProgramError)) throw error;
      let index = error.sourceLine === undefined ? -1 : error.sourceLine - 1;
      if (index === -1) {
        // A non-ASCII character throws without line attribution; recover it ourselves.
        index = lines.findIndex((line, candidateIndex) => !blanked.has(candidateIndex) && !isPrintableAscii(line));
      }
      if (index === -1 || blanked.has(index)) throw error;
      blanked.add(index);
      diagnostics.push({line: index + 1, message: error.message, code: 'basic.parse'});
    }
  }

  try {
    compileBasicProgram(candidate);
  } catch (error) {
    if (!(error instanceof BasicProgramError)) throw error;
    const lastLine = [...lines.keys()].reverse().find(index => !blanked.has(index) && lines[index]!.trim() !== '');
    diagnostics.push({line: (lastLine ?? Math.max(lines.length - 1, 0)) + 1, message: error.message, code: 'basic.compile'});
  }

  const document = analyzeProgramLines(text);
  for (const reference of document.references) {
    if (!document.definitions.has(reference.target)) {
      diagnostics.push({
        line: reference.line,
        startCharacter: reference.startCharacter,
        endCharacter: reference.endCharacter,
        message: `${reference.keyword} target line ${reference.target} does not exist`,
        code: 'basic.target',
      });
    }
  }
  for (const line of document.definitions.values()) diagnostics.push(...syntaxDiagnosticsForLine(line));

  return diagnostics.sort((a, b) => a.line - b.line || (a.startCharacter ?? 0) - (b.startCharacter ?? 0));
}

const KEYWORD_CHAR = /[A-Za-z]/u;

function wordAt(lineText: string, character: number): {word: string; end: number} | undefined {
  if (character < 0 || character > lineText.length) return undefined;
  let start = character, end = character;
  while (start > 0 && KEYWORD_CHAR.test(lineText[start - 1]!)) start--;
  while (end < lineText.length && KEYWORD_CHAR.test(lineText[end]!)) end++;
  if (start === end) return undefined;
  return {word: lineText.slice(start, end).toUpperCase(), end};
}

function hex(value: number): string {
  return `$${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

const PREFIXED_TABLES: ReadonlyArray<{category: 'extensionFunction' | 'extension' | 'extension2'; list: readonly string[]; prefix: number}> = [
  {category: 'extensionFunction', list: basicTokenTables.extensionFunction, prefix: basicTokenTables.extensionFunctionPrefix},
  {category: 'extension', list: basicTokenTables.extension, prefix: basicTokenTables.extensionPrefix},
  {category: 'extension2', list: basicTokenTables.extension2, prefix: basicTokenTables.extension2Prefix},
];

/** Look up a keyword using the ROM's own tokenizer search order: MON, extensionFunction, extension, extension2, primary. */
function findKeyword(word: string): BasicHoverInfo | undefined {
  if (word === 'MON') return {keyword: 'MON', category: 'special', token: hex(basicTokenTables.mon)};
  for (const table of PREFIXED_TABLES) {
    const index = table.list.indexOf(word);
    if (index !== -1) {
      return {keyword: word, category: table.category, token: `${hex(table.prefix)},${hex(basicTokenTables.extensionSubtokenStart + index)}`};
    }
  }
  const primaryIndex = (basicTokenTables.primary as readonly string[]).indexOf(word);
  if (primaryIndex !== -1) return {keyword: word, category: 'primary', token: hex(basicTokenTables.primaryStart + primaryIndex)};
  return undefined;
}

/**
 * `line` is 1-based; `character` is a 0-based column within that physical line.
 * A trailing `$`/`(` is only ever part of the keyword itself for entries like
 * `STR$`/`TAB(` — try that form first, then fall back to the bare word, rather
 * than assuming every following `(` (e.g. any `CUE(0)` function call) belongs
 * to the keyword.
 */
export function hoverAt(text: string, line: number, character: number): BasicHoverInfo | undefined {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!Number.isInteger(line) || line < 1) throw new RangeError('line must be a positive integer');
  if (!Number.isInteger(character) || character < 0) throw new RangeError('character must be a non-negative integer');
  const lineText = splitPhysicalLines(text)[line - 1];
  if (lineText === undefined) return undefined;
  const found = wordAt(lineText, character);
  if (found === undefined) return undefined;
  const suffix = lineText[found.end];
  if (suffix === '$' || suffix === '(') {
    const withSuffix = findKeyword(found.word + suffix);
    if (withSuffix) return withSuffix;
  }
  return findKeyword(found.word);
}

/** All ROM keywords whose name starts with `prefix` (case-insensitive); empty prefix returns every keyword. */
export function completionsFor(prefix: string): BasicCompletionItem[] {
  if (typeof prefix !== 'string') throw new TypeError('prefix must be a string');
  const upper = prefix.toUpperCase();
  const seen = new Set<string>();
  const items: BasicCompletionItem[] = [];
  const add = (keyword: string, category: BasicKeywordCategory) => {
    if (seen.has(keyword) || !keyword.startsWith(upper)) return;
    seen.add(keyword);
    items.push({keyword, category});
  };
  add('MON', 'special');
  for (const table of PREFIXED_TABLES) for (const keyword of table.list) add(keyword, table.category);
  for (const keyword of basicTokenTables.primary) add(keyword, 'primary');
  return items.sort((a, b) => a.keyword.localeCompare(b.keyword));
}

interface ProgramLine {
  physicalLine: number;
  number: number;
  numberStart: number;
  numberEnd: number;
  body: string;
  bodyStart: number;
}

interface LineReference {
  line: number;
  target: number;
  keyword: string;
  startCharacter: number;
  endCharacter: number;
}

interface VariableOccurrence extends BasicSourceLocation {name: string; key: string}

function variableKey(name: string): string {
  const upper = name.toUpperCase();
  const suffix = upper.endsWith('$') || upper.endsWith('%') ? upper.at(-1)! : '';
  return upper.slice(0, Math.min(2, upper.length - suffix.length)) + suffix;
}

function parsedPhysicalLine(raw: string, physicalLine: number): ProgramLine | undefined {
  const match = /^(\s*)([0-9]+)(.*)$/u.exec(raw);
  if (!match) return undefined;
  try {
    parseBasicSource(raw);
  } catch (error) {
    if (error instanceof BasicProgramError) return undefined;
    throw error;
  }
  const number = Number(match[2]);
  const remainder = match[3]!;
  const leadingBodySpaces = /^ */u.exec(remainder)![0].length;
  return {
    physicalLine,
    number,
    numberStart: match[1]!.length,
    numberEnd: match[1]!.length + match[2]!.length,
    body: remainder.slice(leadingBodySpaces),
    bodyStart: match[1]!.length + match[2]!.length + leadingBodySpaces,
  };
}

function referencesInBody(body: string): Omit<LineReference, 'line'>[] {
  const {lexemes} = tokenizeBasicLineWithSpans(body);
  const references: Omit<LineReference, 'line'>[] = [];
  const readTargets = (keyword: string, from: number) => {
    let cursor = from;
    for (;;) {
      while (body[cursor] === ' ') cursor++;
      const match = /^[0-9]+/u.exec(body.slice(cursor));
      if (!match) return;
      const target = Number(match[0]);
      references.push({target, keyword, startCharacter: cursor, endCharacter: cursor + match[0].length});
      cursor += match[0].length;
      while (body[cursor] === ' ') cursor++;
      if (body[cursor] !== ',') return;
      cursor++;
    }
  };

  for (let index = 0; index < lexemes.length; index++) {
    const lexeme = lexemes[index]!;
    if (lexeme.keyword === 'GOTO' || lexeme.keyword === 'GOSUB' || lexeme.keyword === 'THEN' || lexeme.keyword === 'RUN') {
      readTargets(lexeme.keyword, lexeme.end);
      continue;
    }
    if (lexeme.keyword === 'GO') {
      const next = lexemes.slice(index + 1).find(item => !(item.kind === 'text' && /^ +$/u.test(body.slice(item.start, item.end))));
      if (next?.keyword === 'TO') readTargets('GO TO', next.end);
    }
  }
  return references;
}

function analyzeProgramLines(text: string): {definitions: Map<number, ProgramLine>; references: LineReference[]} {
  const definitions = new Map<number, ProgramLine>();
  splitPhysicalLines(text).forEach((raw, index) => {
    const line = parsedPhysicalLine(raw, index + 1);
    if (!line) return;
    if (line.body === '') definitions.delete(line.number);
    else definitions.set(line.number, line);
  });
  const references = [...definitions.values()].flatMap(line => referencesInBody(line.body).map(reference => ({
    ...reference,
    line: line.physicalLine,
    startCharacter: reference.startCharacter + line.bodyStart,
    endCharacter: reference.endCharacter + line.bodyStart,
  })));
  return {definitions, references};
}

function variableOccurrences(text: string): VariableOccurrence[] {
  const occurrences: VariableOccurrence[] = [];
  for (const line of analyzeProgramLines(text).definitions.values()) {
    const {lexemes} = tokenizeBasicLineWithSpans(line.body);
    let runStart = -1, runEnd = -1;
    const flush = () => {
      if (runStart < 0) return;
      const run = line.body.slice(runStart, runEnd);
      for (const match of run.matchAll(/[A-Za-z][A-Za-z0-9]*[$%]?/gu)) {
        const start = runStart + match.index!;
        const name = match[0].toUpperCase();
        occurrences.push({
          name, key: variableKey(name), line: line.physicalLine,
          startCharacter: line.bodyStart + start, endCharacter: line.bodyStart + start + match[0].length,
        });
      }
      runStart = runEnd = -1;
    };
    for (const lexeme of lexemes) {
      if (lexeme.kind === 'text' && (runEnd === -1 || lexeme.start === runEnd)) {
        if (runStart === -1) runStart = lexeme.start;
        runEnd = lexeme.end;
      } else {
        flush();
        if (lexeme.kind === 'text') { runStart = lexeme.start; runEnd = lexeme.end; }
      }
    }
    flush();
  }
  return occurrences;
}

function syntaxDiagnosticsForLine(line: ProgramLine): BasicLspDiagnostic[] {
  const {lexemes} = tokenizeBasicLineWithSpans(line.body);
  const diagnostics: BasicLspDiagnostic[] = [];
  const protectedAt = new Set<number>();
  for (const lexeme of lexemes) {
    if (lexeme.kind === 'literal' || lexeme.kind === 'data' || lexeme.kind === 'remark') {
      for (let at = lexeme.start; at < lexeme.end; at++) protectedAt.add(at);
    }
  }
  const stack: number[] = [];
  for (let at = 0; at < line.body.length; at++) {
    if (protectedAt.has(at)) continue;
    if (line.body[at] === '(') stack.push(at);
    else if (line.body[at] === ')') {
      if (stack.length) stack.pop();
      else diagnostics.push({line: line.physicalLine, startCharacter: line.bodyStart + at, endCharacter: line.bodyStart + at + 1, message: 'Unmatched closing parenthesis', code: 'basic.syntax'});
    }
  }
  for (const at of stack) diagnostics.push({line: line.physicalLine, startCharacter: line.bodyStart + at, endCharacter: line.bodyStart + at + 1, message: 'Unmatched opening parenthesis', code: 'basic.syntax'});

  for (const lexeme of lexemes) {
    if (!lexeme.keyword || !basicFunctionKeywords.has(lexeme.keyword)) continue;
    const signature = basicSignatureByKeyword.get(lexeme.keyword)!;
    let open = lexeme.keyword.endsWith('(') ? lexeme.end - 1 : lexeme.end;
    if (lexeme.keyword === 'FN') {
      while (line.body[open] === ' ') open++;
      const name = /^[A-Za-z][A-Za-z0-9]*[$%]?/u.exec(line.body.slice(open));
      if (name) open += name[0].length;
    }
    while (line.body[open] === ' ') open++;
    if (line.body[open] !== '(') continue;
    let depth = 1, commas = 0, close = -1, hasArgument = false;
    for (let at = open + 1; at < line.body.length; at++) {
      if (protectedAt.has(at)) { hasArgument = true; continue; }
      const char = line.body[at]!;
      if (char === '(') { depth++; hasArgument = true; }
      else if (char === ')') { if (--depth === 0) { close = at; break; } }
      else if (char === ',' && depth === 1) commas++;
      else if (char !== ' ') hasArgument = true;
    }
    if (close === -1) continue;
    const count = hasArgument ? commas + 1 : 0;
    const required = signature.parameters.filter(parameter => !parameter.endsWith('?')).length;
    if (count < required || count > signature.parameters.length) {
      diagnostics.push({
        line: line.physicalLine, startCharacter: line.bodyStart + lexeme.start, endCharacter: line.bodyStart + close + 1,
        message: `${lexeme.keyword.replace(/\($/u, '')} expects ${required === signature.parameters.length ? required : `${required}..${signature.parameters.length}`} argument(s), found ${count}`,
        code: 'basic.syntax',
      });
    }
  }
  return diagnostics;
}

/** Resolve a static line-number reference under the cursor to its effective numbered-line definition. */
export function definitionAt(text: string, line: number, character: number): BasicDefinition | undefined {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!Number.isInteger(line) || line < 1) throw new RangeError('line must be a positive integer');
  if (!Number.isInteger(character) || character < 0) throw new RangeError('character must be a non-negative integer');
  const document = analyzeProgramLines(text);
  const reference = document.references.find(item => item.line === line && character >= item.startCharacter && character < item.endCharacter);
  if (!reference) return undefined;
  const target = document.definitions.get(reference.target);
  return target && {line: target.physicalLine, startCharacter: target.numberStart, endCharacter: target.numberEnd};
}

type SymbolAt = {kind: 'line'; value: number} | {kind: 'variable'; value: string};

function symbolAt(text: string, line: number, character: number): SymbolAt | undefined {
  const document = analyzeProgramLines(text);
  for (const definition of document.definitions.values()) {
    if (definition.physicalLine === line && character >= definition.numberStart && character < definition.numberEnd) {
      return {kind: 'line', value: definition.number};
    }
  }
  const reference = document.references.find(item => item.line === line && character >= item.startCharacter && character < item.endCharacter);
  if (reference) return {kind: 'line', value: reference.target};
  const variable = variableOccurrences(text).find(item => item.line === line && character >= item.startCharacter && character < item.endCharacter);
  return variable && {kind: 'variable', value: variable.key};
}

/** Find all line-number or variable occurrences for the symbol under the cursor. */
export function referencesAt(text: string, line: number, character: number, includeDeclaration = true): BasicSourceLocation[] {
  const symbol = symbolAt(text, line, character);
  if (!symbol) return [];
  if (symbol.kind === 'variable') {
    return variableOccurrences(text)
      .filter(item => item.key === symbol.value)
      .map(({line: itemLine, startCharacter, endCharacter}) => ({line: itemLine, startCharacter, endCharacter}));
  }
  const document = analyzeProgramLines(text);
  const result: BasicSourceLocation[] = [];
  const definition = document.definitions.get(symbol.value);
  if (includeDeclaration && definition) result.push({line: definition.physicalLine, startCharacter: definition.numberStart, endCharacter: definition.numberEnd});
  result.push(...document.references.filter(item => item.target === symbol.value)
    .map(item => ({line: item.line, startCharacter: item.startCharacter, endCharacter: item.endCharacter})));
  return result;
}

/** Produce validated edits to rename a variable or one effective BASIC line and all of its static references. */
export function renameAt(text: string, line: number, character: number, newName: string): BasicTextEdit[] {
  if (typeof newName !== 'string') throw new TypeError('newName must be a string');
  const symbol = symbolAt(text, line, character);
  if (!symbol) throw new Error('No renameable BASIC symbol at the cursor');
  if (symbol.kind === 'variable') {
    const upper = newName.toUpperCase();
    if (!/^[A-Z][A-Z0-9]*[$%]?$/u.test(upper)) throw new Error('BASIC variable names must start with a letter and may end in $ or %');
    if (tokenizeBasicLineWithSpans(upper).lexemes.some(lexeme => lexeme.keyword !== undefined)) {
      throw new Error('The new variable name contains a BASIC keyword under the ROM tokenizer rules');
    }
    return variableOccurrences(text).filter(item => item.key === symbol.value)
      .map(({line: itemLine, startCharacter, endCharacter}) => ({line: itemLine, startCharacter, endCharacter, newText: upper}));
  }
  if (!/^[0-9]+$/u.test(newName)) throw new Error('A BASIC line must be renamed to a decimal line number');
  const number = Number(newName);
  if (!Number.isSafeInteger(number) || number > basicSourceLimits.maxLineNumber) throw new Error(`BASIC line number must be 0..${basicSourceLimits.maxLineNumber}`);
  const document = analyzeProgramLines(text);
  if (number !== symbol.value && document.definitions.has(number)) throw new Error(`BASIC line ${number} already exists`);
  return referencesAt(text, line, character, true).map(location => ({...location, newText: String(number)}));
}

/** Effective numbered lines plus the first occurrence of every variable. */
export function documentSymbols(text: string): BasicDocumentSymbol[] {
  const document = analyzeProgramLines(text);
  const symbols: BasicDocumentSymbol[] = [...document.definitions.values()]
    .sort((a, b) => a.number - b.number)
    .map(item => ({name: String(item.number), kind: 'line', line: item.physicalLine, startCharacter: item.numberStart, endCharacter: item.numberEnd}));
  const seen = new Set<string>();
  for (const variable of variableOccurrences(text)) {
    if (seen.has(variable.key)) continue;
    seen.add(variable.key);
    symbols.push({name: variable.key, kind: 'variable', line: variable.line, startCharacter: variable.startCharacter, endCharacter: variable.endCharacter});
  }
  return symbols;
}

/** Context-aware keyword and in-document variable completion. */
export function completionsAt(text: string, line: number, character: number): BasicCompletionItem[] {
  const raw = splitPhysicalLines(text)[line - 1] ?? '';
  const before = raw.slice(0, character);
  const prefix = /[A-Za-z][A-Za-z0-9]*[$%]?$/u.exec(before)?.[0] ?? '';
  const body = /^\s*[0-9]+\s*/u.exec(before);
  const current = body ? before.slice(body[0].length) : before;
  const segment = current.slice(current.lastIndexOf(':') + 1);
  const statementPosition = /^\s*[A-Za-z]*$/u.test(segment);
  const keywords = completionsFor(prefix).filter(item => statementPosition
    ? basicStatementKeywords.has(item.keyword)
    : basicFunctionKeywords.has(item.keyword) || ['AND', 'OR', 'NOT', 'TO', 'STEP', 'THEN'].includes(item.keyword));
  if (statementPosition) return keywords;
  const variables = [...new Set(variableOccurrences(text).map(item => item.key))]
    .filter(name => name.startsWith(prefix.toUpperCase()))
    .map(keyword => ({keyword, category: 'variable' as const}));
  return [...keywords, ...variables].sort((a, b) => a.keyword.localeCompare(b.keyword));
}

/** Semantic spans for syntax coloring without a second lexer. */
export function semanticSpans(text: string): BasicSemanticSpan[] {
  const spans: BasicSemanticSpan[] = [];
  const operatorKeywords = new Set(['+', '-', '*', '/', '^', 'AND', 'OR', '>', '=', '<', 'NOT']);
  for (const line of analyzeProgramLines(text).definitions.values()) {
    spans.push({type: 'number', line: line.physicalLine, startCharacter: line.numberStart, endCharacter: line.numberEnd});
    const {lexemes} = tokenizeBasicLineWithSpans(line.body);
    for (const lexeme of lexemes) {
      const location = {line: line.physicalLine, startCharacter: line.bodyStart + lexeme.start, endCharacter: line.bodyStart + lexeme.end};
      if (lexeme.keyword) spans.push({...location, type: operatorKeywords.has(lexeme.keyword) ? 'operator' : 'keyword'});
      else if (lexeme.kind === 'literal' || lexeme.kind === 'data') spans.push({...location, type: 'string'});
      else if (lexeme.kind === 'remark') spans.push({...location, type: 'comment'});
    }
  }
  const variables = variableOccurrences(text);
  spans.push(...variables.map(({name: _name, key: _key, ...location}) => ({...location, type: 'variable' as const})));
  for (const line of analyzeProgramLines(text).definitions.values()) {
    const occupied = variables.filter(item => item.line === line.physicalLine);
    const {lexemes} = tokenizeBasicLineWithSpans(line.body);
    for (const lexeme of lexemes) {
      if (lexeme.kind !== 'text' || lexeme.keyword) continue;
      const text = line.body.slice(lexeme.start, lexeme.end);
      for (const match of text.matchAll(/(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:E[+\-]?[0-9]+)?/giu)) {
        const startCharacter = line.bodyStart + lexeme.start + match.index!;
        const endCharacter = startCharacter + match[0].length;
        if (!occupied.some(item => startCharacter < item.endCharacter && endCharacter > item.startCharacter)) {
          spans.push({type: 'number', line: line.physicalLine, startCharacter, endCharacter});
        }
      }
    }
  }
  return spans.sort((a, b) => a.line - b.line || a.startCharacter - b.startCharacter || a.endCharacter - b.endCharacter);
}

/** Return signature information for the innermost known function call at the cursor. */
export function signatureHelpAt(text: string, line: number, character: number): BasicSignatureHelp | undefined {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!Number.isInteger(line) || line < 1) throw new RangeError('line must be a positive integer');
  if (!Number.isInteger(character) || character < 0) throw new RangeError('character must be a non-negative integer');
  const raw = splitPhysicalLines(text)[line - 1];
  if (raw === undefined) return undefined;
  const parsed = parsedPhysicalLine(raw, line);
  if (!parsed || character < parsed.bodyStart) return undefined;
  const bodyCursor = Math.min(character - parsed.bodyStart, parsed.body.length);
  const {lexemes} = tokenizeBasicLineWithSpans(parsed.body);
  if (lexemes.some(lexeme => (lexeme.kind === 'literal' || lexeme.kind === 'data' || lexeme.kind === 'remark')
    && bodyCursor > lexeme.start && bodyCursor <= lexeme.end)) return undefined;
  let best: {keyword: string; open: number; activeParameter: number} | undefined;
  for (const lexeme of lexemes) {
    if (!lexeme.keyword || basicSignatureByKeyword.get(lexeme.keyword)?.kind !== 'function') continue;
    let open = lexeme.keyword.endsWith('(') ? lexeme.end - 1 : lexeme.end;
    if (lexeme.keyword === 'FN') {
      while (parsed.body[open] === ' ') open++;
      const name = /^[A-Za-z][A-Za-z0-9]*[$%]?/u.exec(parsed.body.slice(open));
      if (name) open += name[0].length;
    }
    while (parsed.body[open] === ' ') open++;
    if (parsed.body[open] !== '(' || open >= bodyCursor) continue;
    let depth = 1, activeParameter = 0, quoted = false;
    for (let at = open + 1; at < bodyCursor; at++) {
      const char = parsed.body[at]!;
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if (char === ',' && depth === 1) activeParameter++;
    }
    if (depth > 0 && (!best || open > best.open)) best = {keyword: lexeme.keyword, open, activeParameter};
  }
  if (best) {
    const signature = basicSignatureByKeyword.get(best.keyword)!;
    return {
      label: signature.label,
      parameters: [...signature.parameters],
      activeParameter: Math.min(best.activeParameter, Math.max(signature.parameters.length - 1, 0)),
    };
  }

  let statementLexeme: (typeof lexemes)[number] | undefined;
  for (const lexeme of lexemes) {
    if (lexeme.start >= bodyCursor) break;
    if (lexeme.kind === 'text' && lexeme.bytes[0] === 0x3a) { statementLexeme = undefined; continue; }
    if (lexeme.keyword && basicSignatureByKeyword.get(lexeme.keyword)?.kind === 'statement') statementLexeme = lexeme;
  }
  if (!statementLexeme?.keyword) return undefined;
  const signature = basicSignatureByKeyword.get(statementLexeme.keyword)!;
  let depth = 0, activeParameter = 0;
  for (const lexeme of lexemes) {
    if (lexeme.start < statementLexeme.end || lexeme.start >= bodyCursor || lexeme.kind === 'literal' || lexeme.kind === 'data' || lexeme.kind === 'remark') continue;
    const char = parsed.body.slice(lexeme.start, lexeme.end);
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) activeParameter++;
  }
  return {
    label: signature.label,
    parameters: [...signature.parameters],
    activeParameter: Math.min(activeParameter, Math.max(signature.parameters.length - 1, 0)),
  };
}

/** Canonical ROM LIST-style formatting: effective lines sorted, keywords uppercased, lexical literals preserved. */
export function formatBasicSource(text: string): string {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  return detokenizeBasicProgram(compileBasicProgram(text));
}

/** Renumber effective program lines and every static GOTO/GOSUB/THEN/RUN target that names one of them. */
export function renumberBasicSource(text: string, options: RenumberBasicOptions = {}): string {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const start = options.start ?? 10, step = options.step ?? 10;
  if (!Number.isInteger(start) || start < 0) throw new RangeError('start must be a non-negative integer');
  if (!Number.isInteger(step) || step < 1) throw new RangeError('step must be a positive integer');
  const lines = parseBasicSource(text);
  const last = lines.length === 0 ? start : start + (lines.length - 1) * step;
  if (last > basicSourceLimits.maxLineNumber) throw new RangeError(`renumbered line number exceeds ${basicSourceLimits.maxLineNumber}`);
  const mapping = new Map(lines.map((line, index) => [line.number, start + index * step]));
  const output = lines.map(line => {
    let body = line.text;
    const replacements = referencesInBody(body)
      .filter(reference => mapping.has(reference.target))
      .sort((a, b) => b.startCharacter - a.startCharacter);
    for (const reference of replacements) {
      body = body.slice(0, reference.startCharacter) + mapping.get(reference.target)! + body.slice(reference.endCharacter);
    }
    return `${mapping.get(line.number)!} ${body}`;
  }).join('\n') + (lines.length ? '\n' : '');
  compileBasicProgram(output);
  return output;
}
