import {BASIC_STYLE_RAW_TILE, isBasicRawTile, parseBasicTag} from './notation.js';
import {basicSourceLimits, basicTokenTables, DATA_TOKEN, PRINT_TOKEN, REM_TOKEN, STYLE_MAX_BYTES} from './token-tables.js';

/** Zero-based, end-exclusive columns of the text an error is about. */
export interface BasicErrorColumns {start: number; end: number}

/** Report invalid portable BASIC source or saved-program bytes. */
export class BasicProgramError extends Error {
  /**
   * Include the one-based physical source line when source parsing supplies it.
   * `columns` are in that physical line, or in the tokenized text when no line is known.
   */
  constructor(message: string, readonly sourceLine?: number, readonly columns?: BasicErrorColumns) {
    super(sourceLine === undefined ? message : `Source line ${sourceLine}: ${message}`);
    this.name = 'BasicProgramError';
  }
}

export interface BasicSourceLine {number: number; text: string}
/** One quoted string's attributes in a line's style sidecar. */
export interface BasicStyleRecord {
  /** Offset of the string's first character in the tokenized text (after the four-byte line header). */
  literalOffset: number;
  /** One overlay attribute byte per character, with BASIC's raw-tile bit as the ROM stores it. */
  attributes: number[];
}
export interface BasicLineLexeme {
  /** Zero-based source columns in the original, untokenized line body. */
  start: number;
  end: number;
  bytes: number[];
  kind: 'keyword' | 'text' | 'literal' | 'data' | 'remark';
  /** Canonical ROM keyword, including PRINT when the source used `?`. */
  keyword?: string;
  /** A `{…}` tag: a style tag stores no bytes, a character tag stores its one byte. */
  tag?: 'style' | 'character';
  /**
   * For a character of a styled quoted string, its stored attribute byte (raw-tile bit included);
   * for a style tag, the attribute it selects.
   */
  attribute?: number;
}
/** Lexical mode the ROM tokenizer is in: `literal` is inside a quoted string. */
export type BasicLexicalMode = 'code' | 'literal' | 'data' | 'remark';
export interface BasicTokenizedLine {
  bytes: Uint8Array;
  lexemes: BasicLineLexeme[];
  /** Sidecar records for the quoted strings that have a style tag and at least one character. */
  styles: BasicStyleRecord[];
  /** Characters the line takes when typed on the machine: a character tag counts as one, a style tag as none. */
  inputLength: number;
  /** Mode after the last character; `literal` means a quoted string is still open. */
  endMode: BasicLexicalMode;
}

interface KeywordMatch {length: number; keyword: string; bytes: number[]}

/** Encode printable ASCII without changing characters in quoted or raw modes. */
function asciiBytes(value: string, label: string, sourceLine?: number): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) {
      throw new BasicProgramError(`${label} must use printable 7-bit ASCII; write other characters in a string, DATA or REM as {$hh}`, sourceLine, {start: index, end: index + 1});
    }
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
/** True for the ASCII letters and digits a variable name is made of. */
function nameCharacter(code: number | undefined): boolean {
  return code !== undefined && ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a));
}

/** True for an ASCII hex digit in either case. */
function hexDigit(code: number | undefined): boolean {
  return code !== undefined && ((code >= 0x30 && code <= 0x39) || (upper(code) >= 0x41 && upper(code) <= 0x46));
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
    const sourceLine = index + 1;
    asciiBytes(raw, 'BASIC source line', sourceLine);
    const lengthError = (): BasicProgramError => new BasicProgramError(`line exceeds the ROM's ${basicSourceLimits.maxInputCharacters}-character input limit`, sourceLine);
    const match = /^\s*([0-9]+)(.*)$/u.exec(raw);
    if (!match) {
      if (raw.length > basicSourceLimits.maxInputCharacters) throw lengthError();
      throw new BasicProgramError('expected a numbered BASIC line', sourceLine);
    }
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number > basicSourceLimits.maxLineNumber) {
      throw new BasicProgramError(`line number must be 0..${basicSourceLimits.maxLineNumber}`, sourceLine);
    }
    const text = match[2]!.replace(/^ +/u, '');
    const bodyStart = raw.length - text.length;
    let bodyLength = 0;
    if (text !== '') {
      try {
        bodyLength = tokenizeBody(text).inputLength;
      } catch (error) {
        if (!(error instanceof BasicProgramError)) throw error;
        const columns = error.columns && {start: error.columns.start + bodyStart, end: error.columns.end + bodyStart};
        throw new BasicProgramError(error.message, sourceLine, columns);
      }
    }
    if (bodyStart + bodyLength > basicSourceLimits.maxInputCharacters) throw lengthError();
    if (text === '') byNumber.delete(number);
    else byNumber.set(number, {number, text});
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** Characters a valid numbered source line takes when typed on the machine; tags count as the characters they store. */
export function basicSourceLineLength(raw: string): number {
  const match = /^\s*[0-9]+ */u.exec(raw);
  const body = match ? raw.slice(match[0].length) : '';
  return raw.length - body.length + (body === '' ? 0 : tokenizeBody(body).inputLength);
}

/** Tokenize one line body without the input-length limit, which callers apply to the line they hold. */
function tokenizeBody(text: string): BasicTokenizedLine {
  const input = asciiBytes(text, 'BASIC line');
  const output: number[] = [];
  const lexemes: BasicLineLexeme[] = [];
  const styles: BasicStyleRecord[] = [];
  let at = 0, rawMode: 'literal' | 'remark' | undefined, data = false, markup = 0;
  /** The open quoted string: where its characters start in the output, and their lexemes. */
  let literal: {offset: number; styled: boolean; attribute: number; cells: BasicLineLexeme[]} | undefined;
  /** Append a lexeme to this line's output. */
  function emit(start: number, end: number, bytes: number[], kind: BasicLineLexeme['kind'], extra: Partial<BasicLineLexeme> = {}): BasicLineLexeme {
    output.push(...bytes);
    const lexeme: BasicLineLexeme = {start, end, bytes, kind, ...extra};
    lexemes.push(lexeme);
    return lexeme;
  }
  /** Count a stored character of the open quoted string at the current style. */
  function addCell(lexeme: BasicLineLexeme, code: number): void {
    lexeme.attribute = literal!.attribute | (isBasicRawTile(code) ? BASIC_STYLE_RAW_TILE : 0);
    literal!.cells.push(lexeme);
  }
  /** Record the open quoted string's attributes when it has a style tag; an unstyled string keeps none. */
  function closeLiteral(): void {
    if (literal!.styled && literal!.cells.length) {
      styles.push({literalOffset: literal!.offset, attributes: literal!.cells.map(cell => cell.attribute!)});
    } else {
      for (const cell of literal!.cells) delete cell.attribute;
    }
    literal = undefined;
  }
  /** Read the `{…}` tag at `at` inside a quoted string, DATA, or REM. */
  function readTag(mode: 'literal' | 'data' | 'remark'): void {
    let close = at + 1;
    while (close < input.length && input[close] !== 0x7d && !(mode === 'literal' && input[close] === 0x22)) close++;
    if (input[close] !== 0x7d) throw new BasicProgramError('unterminated {…} tag: close it with }, or write a literal { as {$7B}', undefined, {start: at, end: close});
    const columns = {start: at, end: close + 1};
    const tag = parseBasicTag(text.slice(at + 1, close));
    if ('error' in tag) throw new BasicProgramError(tag.error, undefined, columns);
    if (tag.kind === 'style') {
      if (mode !== 'literal') throw new BasicProgramError('style tags only apply inside quoted strings', undefined, columns);
      literal!.styled = true;
      literal!.attribute = tag.attribute;
      emit(at, close + 1, [], mode, {tag: 'style', attribute: tag.attribute});
      markup += close + 1 - at;
    } else {
      const lexeme = emit(at, close + 1, [tag.code], mode, {tag: 'character'});
      if (mode === 'literal') addCell(lexeme, tag.code);
      if (mode === 'data' && tag.code === 0x3a) data = false;
      markup += close - at;
    }
    at = close + 1;
  }
  while (input[at] === 0x20) at++;
  while (at < input.length) {
    const code = input[at]!;
    if (rawMode !== undefined) {
      if (code === 0x7b) { readTag(rawMode); continue; }
      const lexeme = emit(at, at + 1, [code], rawMode); at++;
      if (rawMode === 'literal') {
        if (code === 0x22) { closeLiteral(); rawMode = undefined; }
        else addCell(lexeme, code);
      }
      continue;
    }
    if (code === 0x20) { emit(at, at + 1, [code], 'text'); at++; continue; }
    // As in the ROM, a quote starts a string before DATA is checked, so a
    // quoted DATA item is a string whose : does not end the statement.
    if (code === 0x22) {
      emit(at, at + 1, [code], 'literal'); at++;
      rawMode = 'literal';
      literal = {offset: output.length, styled: false, attribute: 0, cells: []};
      continue;
    }
    if (data) {
      if (code === 0x7b) { readTag('data'); continue; }
      emit(at, at + 1, [code], 'data'); at++;
      if (code === 0x3a) data = false;
      continue;
    }
    if (code === 0x3f) { emit(at, at + 1, [PRINT_TOKEN], 'keyword', {keyword: 'PRINT'}); at++; continue; }
    // A $ that doesn't end a string variable name (A$) starts a hex number,
    // whose digits stay as typed, so the CD in $CD00 is not a keyword.
    if (code === 0x24 && !nameCharacter(output[output.length - 1])) {
      let end = at + 1;
      while (hexDigit(input[end])) end++;
      emit(at, end, input.slice(at, end).map(upper), 'text'); at = end;
      continue;
    }
    if ((upper(code) === 0x4d) && matches(input, at, 'MON')) {
      const after = input[at + 3];
      if (after === undefined || after === 0x20 || after === 0x3a) { emit(at, at + 3, [basicTokenTables.mon], 'keyword', {keyword: 'MON'}); at += 3; continue; }
    }
    const match = keywordMatch(input, at);
    if (match) {
      const token = match.bytes[0];
      emit(at, at + match.length, match.bytes, 'keyword', {keyword: match.keyword}); at += match.length;
      if (token === DATA_TOKEN) data = true;
      else if (token === REM_TOKEN) rawMode = 'remark';
      continue;
    }
    emit(at, at + 1, [upper(code)], 'text'); at++;
  }
  const endMode: BasicLexicalMode = rawMode ?? (data ? 'data' : 'code');
  if (literal) closeLiteral();
  const sidecarBytes = styles.reduce((sum, style) => sum + 2 + style.attributes.length, 4);
  if (styles.length && sidecarBytes > STYLE_MAX_BYTES) {
    throw new BasicProgramError(`styled strings need ${sidecarBytes} style bytes but the ROM keeps at most ${STYLE_MAX_BYTES} per line: 4, plus 2 and one per character for each styled string`);
  }
  return {bytes: Uint8Array.from(output), lexemes, styles, inputLength: input.length - markup, endMode};
}

/** Tokenize one line body, reading `{…}` tags, and retain source spans for editor tooling. */
export function tokenizeBasicLineWithSpans(text: string): BasicTokenizedLine {
  if (typeof text !== 'string') throw new TypeError('BASIC line must be a string');
  const line = tokenizeBody(text);
  if (line.inputLength > basicSourceLimits.maxInputCharacters) throw new BasicProgramError(`line exceeds ${basicSourceLimits.maxInputCharacters} characters`);
  return line;
}

/** Tokenize one line body using the ROM's exact table order and lexical modes. */
export function tokenizeBasicLine(text: string): Uint8Array {
  return tokenizeBasicLineWithSpans(text).bytes;
}
