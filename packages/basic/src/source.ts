import {basicSourceLimits, basicTokenTables, DATA_TOKEN, PRINT_TOKEN, REM_TOKEN} from './token-tables.js';

/** Report invalid portable BASIC source or saved-program bytes. */
export class BasicProgramError extends Error {
  /** Include the one-based physical source line when source parsing supplies it. */
  constructor(message: string, readonly sourceLine?: number) {
    super(sourceLine === undefined ? message : `Source line ${sourceLine}: ${message}`);
    this.name = 'BasicProgramError';
  }
}

export interface BasicSourceLine {number: number; text: string}
export interface BasicLineLexeme {
  /** Zero-based source columns in the original, untokenized line body. */
  start: number;
  end: number;
  bytes: number[];
  kind: 'keyword' | 'text' | 'literal' | 'data' | 'remark';
  /** Canonical ROM keyword, including PRINT when the source used `?`. */
  keyword?: string;
}

interface KeywordMatch {length: number; keyword: string; bytes: number[]}

/** Encode printable ASCII without changing characters in quoted or raw modes. */
function asciiBytes(value: string, label: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) throw new BasicProgramError(`${label} must use printable 7-bit ASCII`);
    bytes.push(code);
  }
  return bytes;
}

/** Fold one ASCII lowercase letter to uppercase. */
function upper(code: number): number { return code >= 0x61 && code <= 0x7a ? code - 0x20 : code; }

/** Compare a ROM keyword at a source position without an identifier boundary. */
function matches(input: readonly number[], at: number, keyword: string): boolean {
  if (at + keyword.length > input.length) return false;
  for (let i = 0; i < keyword.length; i++) if (upper(input[at + i]!) !== keyword.charCodeAt(i)) return false;
  return true;
}
/** Find the first ROM keyword according to table and entry search order. */
function keywordMatch(input: readonly number[], at: number): KeywordMatch | undefined {
  const tables: readonly {keywords: readonly string[]; prefix?: number; start: number}[] = [
    {keywords: basicTokenTables.extensionFunction, prefix: basicTokenTables.extensionFunctionPrefix, start: basicTokenTables.extensionSubtokenStart},
    {keywords: basicTokenTables.extension, prefix: basicTokenTables.extensionPrefix, start: basicTokenTables.extensionSubtokenStart},
    {keywords: basicTokenTables.extension2, prefix: basicTokenTables.extension2Prefix, start: basicTokenTables.extensionSubtokenStart},
    {keywords: basicTokenTables.primary, start: basicTokenTables.primaryStart},
  ];
  for (const table of tables) {
    for (let index = 0; index < table.keywords.length; index++) {
      const keyword = table.keywords[index]!;
      if (matches(input, at, keyword)) {
        const token = table.start + index;
        return {length: keyword.length, keyword, bytes: table.prefix === undefined ? [token] : [table.prefix, token]};
      }
    }
  }
  return undefined;
}

/** Parse a portable numbered source file as if its lines were entered in order. */
export function parseBasicSource(source: string): BasicSourceLine[] {
  if (typeof source !== 'string') throw new TypeError('BASIC source must be a string');
  const byNumber = new Map<number, BasicSourceLine>();
  const physical = source.replace(/\r\n?/gu, '\n').split('\n');
  for (let index = 0; index < physical.length; index++) {
    const raw = physical[index]!;
    if (raw.trim() === '') continue;
    if (asciiBytes(raw, 'BASIC source line').length > basicSourceLimits.maxInputCharacters) {
      throw new BasicProgramError(`line exceeds the ROM's ${basicSourceLimits.maxInputCharacters}-character input limit`, index + 1);
    }
    const match = /^\s*([0-9]+)(.*)$/u.exec(raw);
    if (!match) throw new BasicProgramError('expected a numbered BASIC line', index + 1);
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number > basicSourceLimits.maxLineNumber) {
      throw new BasicProgramError(`line number must be 0..${basicSourceLimits.maxLineNumber}`, index + 1);
    }
    const text = match[2]!.replace(/^ +/u, '');
    if (text === '') byNumber.delete(number);
    else byNumber.set(number, {number, text});
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** Tokenize one line body and retain source spans for editor tooling. */
export function tokenizeBasicLineWithSpans(text: string): {bytes: Uint8Array; lexemes: BasicLineLexeme[]} {
  if (typeof text !== 'string') throw new TypeError('BASIC line must be a string');
  const input = asciiBytes(text, 'BASIC line');
  if (input.length > basicSourceLimits.maxInputCharacters) throw new BasicProgramError(`line exceeds ${basicSourceLimits.maxInputCharacters} characters`);
  const output: number[] = [];
  const lexemes: BasicLineLexeme[] = [];
  let at = 0, rawMode: 'literal' | 'remark' | undefined, data = false;
  /** Append a lexeme to this line's output. */
  function emit(start: number, end: number, bytes: number[], kind: BasicLineLexeme['kind'], keyword?: string): void {
    output.push(...bytes);
    lexemes.push({start, end, bytes, kind, ...(keyword === undefined ? {} : {keyword})});
  }
  while (input[at] === 0x20) at++;
  while (at < input.length) {
    const code = input[at]!;
    if (rawMode !== undefined) {
      emit(at, at + 1, [code], rawMode); at++;
      if (rawMode === 'literal' && code === 0x22) rawMode = undefined;
      continue;
    }
    if (code === 0x20) { emit(at, at + 1, [code], 'text'); at++; continue; }
    if (data) {
      emit(at, at + 1, [code], 'data'); at++;
      if (code === 0x3a) data = false;
      continue;
    }
    if (code === 0x22) { emit(at, at + 1, [code], 'literal'); at++; rawMode = 'literal'; continue; }
    if (code === 0x3f) { emit(at, at + 1, [PRINT_TOKEN], 'keyword', 'PRINT'); at++; continue; }
    if ((upper(code) === 0x4d) && matches(input, at, 'MON')) {
      const after = input[at + 3];
      if (after === undefined || after === 0x20 || after === 0x3a) { emit(at, at + 3, [basicTokenTables.mon], 'keyword', 'MON'); at += 3; continue; }
    }
    const match = keywordMatch(input, at);
    if (match) {
      const token = match.bytes[0];
      emit(at, at + match.length, match.bytes, 'keyword', match.keyword); at += match.length;
      if (token === DATA_TOKEN) data = true;
      else if (token === REM_TOKEN) rawMode = 'remark';
      continue;
    }
    emit(at, at + 1, [upper(code)], 'text'); at++;
  }
  return {bytes: Uint8Array.from(output), lexemes};
}

/** Tokenize one line body using the ROM's exact table order and lexical modes. */
export function tokenizeBasicLine(text: string): Uint8Array {
  return tokenizeBasicLineWithSpans(text).bytes;
}
