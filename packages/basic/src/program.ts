import {BASIC_STYLE_RAW_TILE, formatBasicCharacter, formatBasicStyleTag, isBasicRawTile} from './notation.js';
import {BasicProgramError, parseBasicSource, tokenizeBasicLineWithSpans, type BasicSourceLine, type BasicStyleRecord} from './source.js';
import {basicSourceLimits, basicTokenTables, DATA_TOKEN, REM_TOKEN, STYLE_MAGIC_0, STYLE_MAGIC_1, STYLE_MAX_BYTES} from './token-tables.js';

/** A stored line; `text` is its body in source notation, with `{…}` tags for glyphs and styles. */
export interface BasicStoredLine extends BasicSourceLine {
  offset: number;
  nextAddress: number;
  tokens: number[];
  styles: BasicStyleRecord[];
}
export interface BasicProgramInfo {lines: BasicStoredLine[]; byteLength: number; relocatableLinks: boolean}
export interface CompileBasicOptions {
  /** Emit runnable absolute forward links for this TXTTAB address. Omit for a LOAD-only relocatable file. */
  baseAddress?: number;
}
export interface InspectBasicOptions {
  /** When supplied, require every stored forward link to match this TXTTAB address. */
  baseAddress?: number;
}

/** Apply the accepted TXTTAB address range used by both compilation and inspection. */
function validateBaseAddress(baseAddress: number | undefined): void {
  if (baseAddress !== undefined && (!Number.isInteger(baseAddress) || baseAddress < 0x100 || baseAddress >= 0xc000)) {
    throw new RangeError('baseAddress must be 256..49151');
  }
}

/** Encode a line's style records as the sidecar the ROM appends after its terminator. */
function styleSidecar(styles: readonly BasicStyleRecord[]): number[] {
  if (styles.length === 0) return [];
  const records = styles.flatMap(style => [style.literalOffset, style.attributes.length, ...style.attributes]);
  return [STYLE_MAGIC_0, STYLE_MAGIC_1, 4 + records.length, styles.length, ...records];
}

/** Encode numbered lines with relocatable or absolute forward links. */
function compileLines(lines: readonly BasicSourceLine[], baseAddress: number | undefined): Uint8Array {
  validateBaseAddress(baseAddress);
  const records = lines.map(line => {
    const tokenized = tokenizeBasicLineWithSpans(line.text);
    const tokens = tokenized.bytes, sidecar = styleSidecar(tokenized.styles);
    return {line, tokens, sidecar, length: 5 + tokens.length + sidecar.length};
  });
  const byteLength = records.reduce((sum, record) => sum + record.length, 2);
  if (byteLength > 0xffff || (baseAddress !== undefined && baseAddress + byteLength > 0xc000)) {
    throw new BasicProgramError('tokenized program does not fit below the $C000 I/O boundary');
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const record of records) {
    const next = baseAddress === undefined ? 0xffff : baseAddress + offset + record.length;
    output[offset] = next & 0xff; output[offset + 1] = next >>> 8;
    output[offset + 2] = record.line.number & 0xff; output[offset + 3] = record.line.number >>> 8;
    output.set(record.tokens, offset + 4);
    output.set(record.sidecar, offset + 5 + record.tokens.length);
    offset += record.length;
  }
  return output;
}

/** Compile source to the raw file consumed by BASIC LOAD (there is no PRG header). */
export function compileBasicProgram(source: string, options: CompileBasicOptions = {}): Uint8Array {
  return compileLines(parseBasicSource(source), options.baseAddress);
}

/** Write a quoted string's characters, with a style tag wherever its stored attribute changes. */
function decodeLiteral(content: readonly number[], attributes: readonly number[] | undefined, lineNumber: number): string {
  let text = '', previous: number | undefined;
  content.forEach((code, index) => {
    if (attributes) {
      const stored = attributes[index]!;
      if (((stored & BASIC_STYLE_RAW_TILE) !== 0) !== isBasicRawTile(code)) {
        const hex = (value: number): string => `$${value.toString(16).toUpperCase().padStart(2, '0')}`;
        throw new BasicProgramError(`line ${lineNumber}: style attribute ${hex(stored)} of character ${hex(code)} breaks the screen editor's raw-tile rule (bit 6 set exactly for characters outside $20-$7E), which source notation cannot represent`);
      }
      const attribute = stored & ~BASIC_STYLE_RAW_TILE;
      if (attribute !== previous) text += formatBasicStyleTag(attribute);
      previous = attribute;
    }
    text += formatBasicCharacter(code);
  });
  return text;
}

/** Decode a line body in source notation using the ROM's lexical modes, matching each style record to its quoted string. */
function decodeTokenBody(tokens: readonly number[], styles: readonly BasicStyleRecord[], lineNumber: number): string {
  const records = new Map<number, BasicStyleRecord>();
  for (const style of styles) {
    if (records.has(style.literalOffset)) throw new BasicProgramError('BASIC style record does not describe a quoted literal');
    records.set(style.literalOffset, style);
  }
  let text = '', at = 0, data = false, remark = false;
  while (at < tokens.length) {
    const byte = tokens[at++]!;
    if (remark || (data && byte !== 0x22)) {
      text += formatBasicCharacter(byte);
      if (data && byte === 0x3a) data = false;
      continue;
    }
    if (byte === 0x22) {
      // The string runs to the next quote or, left open, to the end of the line.
      let close = at;
      while (close < tokens.length && tokens[close] !== 0x22) close++;
      const record = records.get(at);
      if (record) {
        if (record.attributes.length !== close - at) throw new BasicProgramError('BASIC style record does not describe a quoted literal');
        records.delete(at);
      }
      text += `"${decodeLiteral(tokens.slice(at, close), record?.attributes, lineNumber)}${close < tokens.length ? '"' : ''}`;
      at = close + 1;
      continue;
    }
    if (byte < 0x80) { text += String.fromCharCode(byte); continue; }
    if (byte === basicTokenTables.mon) { text += 'MON'; continue; }
    const prefixed = byte === basicTokenTables.extensionFunctionPrefix ? basicTokenTables.extensionFunction
      : byte === basicTokenTables.extensionPrefix ? basicTokenTables.extension
      : byte === basicTokenTables.extension2Prefix ? basicTokenTables.extension2 : undefined;
    if (prefixed) {
      const subtoken = tokens[at++];
      if (subtoken === undefined || subtoken < 0x80 || subtoken - 0x80 >= prefixed.length) throw new BasicProgramError('invalid extension token');
      text += prefixed[subtoken - 0x80];
      continue;
    }
    const index = byte - basicTokenTables.primaryStart;
    const keyword = basicTokenTables.primary[index];
    if (keyword === undefined) throw new BasicProgramError(`unknown BASIC token $${byte.toString(16).toUpperCase().padStart(2, '0')}`);
    text += keyword;
    if (byte === DATA_TOKEN) data = true;
    if (byte === REM_TOKEN) remark = true;
  }
  if (records.size) throw new BasicProgramError('BASIC style record does not describe a quoted literal');
  return text;
}

/** Read an optional literal-style sidecar and return the next line offset. */
function inspectStyles(file: Uint8Array, offset: number): {styles: BasicStyleRecord[]; nextOffset: number} {
  if (file[offset] !== STYLE_MAGIC_0 || file[offset + 1] !== STYLE_MAGIC_1) return {styles: [], nextOffset: offset};
  const length = file[offset + 2];
  const count = file[offset + 3];
  if (length === undefined || count === undefined || length < 4 || length > STYLE_MAX_BYTES || offset + length > file.length) throw new BasicProgramError('invalid BASIC style sidecar');
  const styles: BasicStyleRecord[] = [];
  let cursor = offset + 4;
  for (let record = 0; record < count; record++) {
    const literalOffset = file[cursor++], literalLength = file[cursor++];
    if (literalOffset === undefined || literalLength === undefined || literalLength === 0 || cursor + literalLength > offset + length) throw new BasicProgramError('invalid BASIC style record');
    styles.push({literalOffset, attributes: Array.from(file.slice(cursor, cursor + literalLength))});
    cursor += literalLength;
  }
  if (cursor !== offset + length) throw new BasicProgramError('BASIC style sidecar length does not match its records');
  return {styles, nextOffset: offset + length};
}

/** Validate and inspect a raw SAVE/LOAD program image without mutating it. */
export function inspectBasicProgram(file: Uint8Array, options: InspectBasicOptions = {}): BasicProgramInfo {
  if (!(file instanceof Uint8Array)) throw new TypeError('BASIC program must be a Uint8Array');
  if (file.length < 2) throw new BasicProgramError('BASIC program is missing its end marker');
  const base = options.baseAddress;
  validateBaseAddress(base);
  const lines: BasicStoredLine[] = [];
  let offset = 0, previous = -1, relocatableLinks = true;
  while (true) {
    const lo = file[offset], hi = file[offset + 1];
    if (lo === undefined || hi === undefined) throw new BasicProgramError('BASIC program is missing its end marker');
    if (lo === 0 && hi === 0) {
      if (offset + 2 !== file.length) throw new BasicProgramError('bytes follow the BASIC end marker');
      break;
    }
    if (hi === 0 || offset + 4 >= file.length) throw new BasicProgramError('invalid BASIC forward link');
    const lineNumber = file[offset + 2]! | (file[offset + 3]! << 8);
    if (lineNumber > basicSourceLimits.maxLineNumber || lineNumber <= previous) throw new BasicProgramError('BASIC line numbers must be strictly increasing and at most 63999');
    let terminator = offset + 4;
    while (terminator < file.length && file[terminator] !== 0) terminator++;
    if (terminator === file.length) throw new BasicProgramError('unterminated BASIC line');
    const tokens = Array.from(file.slice(offset + 4, terminator));
    const styled = inspectStyles(file, terminator + 1);
    const text = decodeTokenBody(tokens, styled.styles, lineNumber);
    const nextOffset = styled.nextOffset;
    const nextAddress = lo | (hi << 8);
    if (nextAddress !== 0xffff) relocatableLinks = false;
    if (base !== undefined && nextAddress !== base + nextOffset) throw new BasicProgramError('BASIC forward link does not match baseAddress');
    lines.push({number: lineNumber, text, offset, nextAddress, tokens, styles: styled.styles});
    previous = lineNumber;
    offset = nextOffset;
  }
  return {lines, byteLength: file.length, relocatableLinks};
}

/** Render canonical LIST-style source from a validated SAVE/LOAD image. */
export function detokenizeBasicProgram(file: Uint8Array, options: InspectBasicOptions = {}): string {
  const lines = inspectBasicProgram(file, options).lines;
  return lines.map(line => `${line.number} ${line.text}`).join('\n') + (lines.length ? '\n' : '');
}
