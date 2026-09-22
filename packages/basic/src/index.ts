import {
  assertValid,
  diagnostic,
  result,
  schemaDiagnostics,
  type ClementinaDiagnostic,
  type ValidationResult,
} from '@clementina/core';

export interface MiaLoadStep {
  kind: 'mia';
  path: string;
  address: number;
  /** Exact generated file length, used for bounds checks. */
  length: number;
}

export interface PrgLoadStep {
  kind: 'prg';
  path: string;
  loadAddress: number;
  /** Payload length, excluding the two- or three-byte PRG header. */
  length: number;
  /** Required for load addresses $8000-$BFFF; forbidden below $8000. */
  bank?: number;
  /** A nonzero value makes this the terminal takeover step. */
  runAddress?: number;
}

export interface BasicLoadStep {
  kind: 'basic';
  path: string;
  /** Exact raw SAVE/LOAD file length. */
  length: number;
}

export type LoadStep = MiaLoadStep | PrgLoadStep | BasicLoadStep;
export interface LoadPlan {
  format: 'clementina-load-plan';
  version: 1;
  steps: LoadStep[];
}

export interface PrgInfo {
  loadAddress: number;
  bank?: number;
  headerLength: 2 | 3;
  payloadLength: number;
}

export interface LoadPlanLaunch {
  /** Numbered lines define a temporary bootstrap; direct lines execute immediately. */
  mode: 'numbered' | 'direct';
  lines: string[];
  startCommand: 'RUN';
}

const MIA_SIZE = 0x40000;
/** SD/FS control/sector/path/dir/transfer state; permanently reserved (see specs/storage.json). */
const SDFS_RESERVED_START = 0x13000;
const SDFS_RESERVED_END = 0x13c00;
const KERNEL_BASE = 0x04b7;
const BASIC_LINE_LIMIT = 71;

function portablePath(path: string): boolean {
  return path.length > 0 && path.length <= 255 && !path.startsWith('/') && !path.includes('\\')
    && !path.includes('"') && !/[\u0000-\u001f\u007f]/u.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function prgCapacity(step: Pick<PrgLoadStep, 'loadAddress' | 'bank'>): number {
  if (step.loadAddress < 0x8000) return 0x8000 - step.loadAddress;
  if (step.bank === undefined) return 0;
  return (32 - step.bank) * 0x4000 - (step.loadAddress - 0x8000);
}

/** Validate an untrusted, versioned load plan without coercion. */
export function checkLoadPlan(value: unknown): ValidationResult<LoadPlan> {
  const diagnostics = schemaDiagnostics('load-plan', value);
  if (diagnostics.length) return result(value, diagnostics);
  const plan = value as LoadPlan;
  let terminal = -1;

  plan.steps.forEach((step, index) => {
    const base = `/steps/${index}`;
    if (!portablePath(step.path)) {
      diagnostics.push(diagnostic('load.path', `${base}/path`, 'Expected a relative portable path without traversal, quotes, or control characters'));
    }
    if (step.kind === 'mia') {
      const end = step.address + step.length;
      if (end > MIA_SIZE) diagnostics.push(diagnostic('load.mia.bounds', base, 'MIA load exceeds the 256 KiB MIA RAM'));
      if (step.address < SDFS_RESERVED_END && end > SDFS_RESERVED_START) {
        diagnostics.push(diagnostic('load.mia.reserved', base, 'MIA load overlaps the permanently reserved SD/FS state region $13000-$13BFF'));
      }
      return;
    }

    if (step.kind === 'basic') {
      if (terminal !== -1) diagnostics.push(diagnostic('load.run.multiple', base, 'Only one terminal program step is allowed'));
      terminal = index;
      return;
    }

    const banked = step.loadAddress >= 0x8000;
    if (banked && step.bank === undefined) diagnostics.push(diagnostic('load.prg.bank', `${base}/bank`, 'Bank 1-31 is required for a PRG loading at $8000-$BFFF'));
    if (!banked && step.bank !== undefined) diagnostics.push(diagnostic('load.prg.bank', `${base}/bank`, 'An unbanked PRG must not declare a bank'));
    if (step.length > prgCapacity(step)) diagnostics.push(diagnostic('load.prg.bounds', base, 'PRG payload exceeds its available unbanked RAM or banks 1-31'));
    if (step.runAddress !== undefined) {
      if (terminal !== -1) diagnostics.push(diagnostic('load.run.multiple', `${base}/runAddress`, 'Only one terminal run step is allowed'));
      terminal = index;
    } else if (!banked) {
      diagnostics.push(diagnostic('load.prg.return', base, `Portable plans do not use returning unbanked BLOADs: below $${KERNEL_BASE.toString(16).toUpperCase()} is system RAM and at/above it may overwrite BASIC; use a banked image or make it the terminal run step`));
    }
  });

  if (terminal === -1) diagnostics.push(diagnostic('load.run.missing', '/steps', 'A terminal PRG run or BASIC program step is required'));
  else if (terminal !== plan.steps.length - 1) diagnostics.push(diagnostic('load.run.order', `/steps/${terminal}`, 'The run step must be last because it does not return to BASIC'));
  return result(value, diagnostics);
}

export function validateLoadPlan(value: unknown): asserts value is LoadPlan {
  assertValid(checkLoadPlan(value));
}

function basicLine(number: number, statement: string, diagnostics: ClementinaDiagnostic[], path: string): string {
  const line = `${number} ${statement}`;
  if (line.length > BASIC_LINE_LIMIT) diagnostics.push(diagnostic('load.basic.line', path, `Generated BASIC line exceeds the ${BASIC_LINE_LIMIT}-character input limit`));
  return line;
}

function loadStatement(step: LoadStep): string {
  if (step.kind === 'mia') return `MIALOAD "${step.path}",${step.address}${step.length <= 0xffff ? `,${step.length}` : ''}`;
  if (step.kind === 'basic') return `LOAD "${step.path}"`;
  return `BLOAD "${step.path}"${step.runAddress === undefined ? '' : `,${step.runAddress}`}`;
}

/** Render source lines for the ROM tokenizer. This does not implement a second tokenizer. */
export function checkBootstrapSource(value: unknown): ValidationResult<string[]> {
  const checked = checkLoadPlan(value);
  if (!checked.ok) return checked as ValidationResult<string[]>;
  const diagnostics: ClementinaDiagnostic[] = [];
  const lines = checked.value.steps.map((step, index) => {
    if (step.kind === 'basic') {
      diagnostics.push(diagnostic('load.basic.bootstrap', `/steps/${index}`, 'A BASIC terminal program uses direct launch commands, not a numbered bootstrap'));
    }
    return basicLine((index + 1) * 10, loadStatement(step), diagnostics, `/steps/${index}/path`);
  });
  return result(lines, diagnostics);
}

export function renderBootstrapSource(value: unknown): string {
  return assertValid(checkBootstrapSource(value)).join('\n') + '\n';
}

/** Validate and render the exact editor commands used to launch either program kind. */
export function checkLoadPlanLaunch(value: unknown): ValidationResult<LoadPlanLaunch> {
  const checked = checkLoadPlan(value);
  if (!checked.ok) return checked as ValidationResult<LoadPlanLaunch>;
  const basic = checked.value.steps.at(-1)?.kind === 'basic';
  if (!basic) {
    const bootstrap = checkBootstrapSource(checked.value);
    return bootstrap.ok
      ? result({mode: 'numbered', lines: bootstrap.value, startCommand: 'RUN'}, [])
      : bootstrap as ValidationResult<LoadPlanLaunch>;
  }
  const diagnostics: ClementinaDiagnostic[] = [];
  const lines = checked.value.steps.map((step, index) => {
    const line = loadStatement(step);
    if (line.length > BASIC_LINE_LIMIT) diagnostics.push(diagnostic('load.basic.line', `/steps/${index}/path`, `Generated BASIC command exceeds the ${BASIC_LINE_LIMIT}-character input limit`));
    return line;
  });
  return result({mode: 'direct', lines, startCommand: 'RUN'}, diagnostics);
}

export function renderLoadPlanLaunch(value: unknown): LoadPlanLaunch {
  return assertValid(checkLoadPlanLaunch(value));
}

function checkPrgShape(loadAddress: number, bank: number | undefined, payloadLength: number): void {
  const step: PrgLoadStep = {
    kind: 'prg', path: 'IMAGE.PRG', loadAddress, length: payloadLength,
    ...(bank === undefined ? {} : {bank}), runAddress: 1,
  };
  assertValid(checkLoadPlan({format: 'clementina-load-plan', version: 1, steps: [step]}));
}

/** Pack bytes in the exact two- or three-byte PRG format consumed by KERN_LOAD. */
export function encodePrg(payload: Uint8Array, loadAddress: number, bank?: number): Uint8Array {
  if (!(payload instanceof Uint8Array) || payload.length === 0) throw new TypeError('PRG payload must be a non-empty Uint8Array');
  checkPrgShape(loadAddress, bank, payload.length);
  const headerLength = bank === undefined ? 2 : 3;
  const output = new Uint8Array(headerLength + payload.length);
  output[0] = loadAddress & 0xff;
  output[1] = loadAddress >>> 8;
  if (bank !== undefined) output[2] = bank;
  output.set(payload, headerLength);
  return output;
}

/** Inspect and validate a PRG header and payload bounds without copying it. */
export function inspectPrg(file: Uint8Array): PrgInfo {
  if (!(file instanceof Uint8Array) || file.length < 3) throw new TypeError('PRG must contain a header and non-empty payload');
  const loadAddress = file[0] | (file[1] << 8);
  const banked = loadAddress >= 0x8000 && loadAddress < 0xc000;
  const headerLength: 2 | 3 = banked ? 3 : 2;
  if (file.length <= headerLength) throw new TypeError('PRG payload must not be empty');
  const bank = banked ? file[2] : undefined;
  checkPrgShape(loadAddress, bank, file.length - headerLength);
  return {loadAddress, ...(bank === undefined ? {} : {bank}), headerLength, payloadLength: file.length - headerLength};
}

/** Token numbers copied from the Clementina ROM's active build tables. */
export const basicTokenTables = {
  primaryStart: 0x80,
  primary: [
    'END','FOR','NEXT','DATA','INPUT','DIM','READ','LET','GOTO','RUN','IF','RESTORE','GOSUB','RETURN','REM','STOP','ON','WAIT','LOAD','SAVE','DEF','POKE',
    'COLOR','FLIPX','FLIPY','ALT','STYLE','CRSR','CLS','PRINT','CONT','LIST','CLEAR','GET','NEW','TAB(','TO','FN','SPC(','THEN','NOT','STEP','+','-','*','/','^','AND','OR','>','=','<',
    'SGN','INT','ABS','USR','FRE','POS','SQR','RND','LOG','EXP','COS','SIN','TAN','ATN','PEEK','LEN','STR$','VAL','ASC','CHR$','LEFT$','RIGHT$','MID$','GO',
  ],
  mon: 0xfe,
  extensionPrefix: 0xff,
  extension: [
    'BCOLOR','SNDON','SNDOFF','SNDCLR','VOL','WAVE','NOTE','FREQ','GATE','ADSR','PULSE','PAN','BGON','BGOFF','BGMODE','BGSET','SCROLL','BGBANK','BGALT','SPRON','SPROFF','SPRCOUNT','SPRBANK','CHRMODE','CHRPLANE','PALETTE','VIDON','VIDOFF','BGCHAR','CHRLOAD','PALLOAD','OAMLOAD','SPRITE','SPRTILE','SPRX','SPRY','SPRCOLOR','SPRFLIP','SPRPRI','OPEN','CLOSE','BGET#','BPUT#',
  ],
  extension2Prefix: 0xfc,
  extension2: [
    'NTREAD','NTLOAD','NTSAVE','ATRREAD','ATRLOAD','ATRSAVE','CHRREAD','CHRSAVE','PALREAD','PALSAVE','OAMREAD','OAMSAVE','MIALOAD','MIASAVE','SEEK#','KILL','RMDIR','MKDIR','NAME','CD','DIR','INPUTMODE','KEYCLEAR','KEYREPEAT','KEYRPT','MOUSE','PADREAD','OVLON','OVLOFF','OVLBANK','OVLALT','DELAY','MPOKE','MCOPY','MFILL','FLUSH','FSTAT','BLOAD','BSAVE','SYS','TRACK','BAND','VTAKE','VGIVE',
  ],
  extensionFunctionPrefix: 0xfd,
  extensionFunction: ['PLAYING','EOF','KEYDOWN','CONSDOWN','INPUTDEV','PADON','PADDIR','PADSTICK','PADBTN','PADAXIS','PADTRIG','TICKS','MPEEK','FPOS','FSIZE','DISKFREE','CUE'],
  extensionSubtokenStart: 0x80,
} as const;

export const basicSourceLimits = {maxLineNumber: 63999, maxInputCharacters: 71} as const;
const DATA_TOKEN = 0x83;
const REM_TOKEN = 0x8e;
const PRINT_TOKEN = 0x9d;
const STYLE_MAGIC_0 = 0xce;
const STYLE_MAGIC_1 = 0xff;
const STYLE_MAX_BYTES = 42;

export class BasicProgramError extends Error {
  constructor(message: string, readonly sourceLine?: number) {
    super(sourceLine === undefined ? message : `Source line ${sourceLine}: ${message}`);
    this.name = 'BasicProgramError';
  }
}

export interface BasicSourceLine {number: number; text: string}
export interface BasicStyleRecord {literalOffset: number; attributes: number[]}
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

function asciiBytes(value: string, label: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) throw new BasicProgramError(`${label} must use printable 7-bit ASCII`);
    bytes.push(code);
  }
  return bytes;
}

function upper(code: number): number { return code >= 0x61 && code <= 0x7a ? code - 0x20 : code; }
function matches(input: readonly number[], at: number, keyword: string): boolean {
  if (at + keyword.length > input.length) return false;
  for (let i = 0; i < keyword.length; i++) if (upper(input[at + i]!) !== keyword.charCodeAt(i)) return false;
  return true;
}
function tableMatch(input: readonly number[], at: number, table: readonly string[]): {index: number; length: number} | undefined {
  for (let index = 0; index < table.length; index++) {
    const keyword = table[index]!;
    if (matches(input, at, keyword)) return {index, length: keyword.length};
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

/** Tokenize one line body using the ROM's exact table order and lexical modes. */
export function tokenizeBasicLine(text: string): Uint8Array {
  if (typeof text !== 'string') throw new TypeError('BASIC line must be a string');
  const input = asciiBytes(text, 'BASIC line');
  if (input.length > basicSourceLimits.maxInputCharacters) throw new BasicProgramError(`line exceeds ${basicSourceLimits.maxInputCharacters} characters`);
  const output: number[] = [];
  let at = 0, rawUntil: number | undefined, data = false;
  while (input[at] === 0x20) at++;
  while (at < input.length) {
    const code = input[at]!;
    if (rawUntil !== undefined) {
      output.push(code); at++;
      if (code === rawUntil) rawUntil = undefined;
      continue;
    }
    if (code === 0x20) { output.push(code); at++; continue; }
    if (data) {
      output.push(code); at++;
      if (code === 0x3a) data = false;
      continue;
    }
    if (code === 0x22) { output.push(code); at++; rawUntil = 0x22; continue; }
    if (code === 0x3f) { output.push(PRINT_TOKEN); at++; continue; }
    if ((upper(code) === 0x4d) && matches(input, at, 'MON')) {
      const after = input[at + 3];
      if (after === undefined || after === 0x20 || after === 0x3a) { output.push(basicTokenTables.mon); at += 3; continue; }
    }
    const extensionFunction = tableMatch(input, at, basicTokenTables.extensionFunction);
    if (extensionFunction) {
      output.push(basicTokenTables.extensionFunctionPrefix, 0x80 + extensionFunction.index); at += extensionFunction.length; continue;
    }
    const extension = tableMatch(input, at, basicTokenTables.extension);
    if (extension) { output.push(basicTokenTables.extensionPrefix, 0x80 + extension.index); at += extension.length; continue; }
    const extension2 = tableMatch(input, at, basicTokenTables.extension2);
    if (extension2) { output.push(basicTokenTables.extension2Prefix, 0x80 + extension2.index); at += extension2.length; continue; }
    const primary = tableMatch(input, at, basicTokenTables.primary);
    if (primary) {
      const token = basicTokenTables.primaryStart + primary.index;
      output.push(token); at += primary.length;
      if (token === DATA_TOKEN) data = true;
      else if (token === REM_TOKEN) rawUntil = 0;
      continue;
    }
    output.push(upper(code)); at++;
  }
  return Uint8Array.from(output);
}

function compileLines(lines: readonly BasicSourceLine[], baseAddress: number | undefined): Uint8Array {
  if (baseAddress !== undefined && (!Number.isInteger(baseAddress) || baseAddress < 0x100 || baseAddress >= 0xc000)) {
    throw new RangeError('baseAddress must be 256..49151');
  }
  const records = lines.map(line => {
    const tokens = tokenizeBasicLine(line.text);
    return {line, tokens, length: 5 + tokens.length};
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
    offset += record.length;
  }
  return output;
}

/** Compile source to the raw file consumed by BASIC LOAD (there is no PRG header). */
export function compileBasicProgram(source: string, options: CompileBasicOptions = {}): Uint8Array {
  return compileLines(parseBasicSource(source), options.baseAddress);
}

function decodeTokenBody(tokens: readonly number[]): string {
  let text = '', at = 0, quoted = false, data = false, remark = false;
  while (at < tokens.length) {
    const byte = tokens[at++]!;
    if (quoted || data || remark) {
      text += String.fromCharCode(byte);
      if (quoted && byte === 0x22) quoted = false;
      if (data && byte === 0x3a) data = false;
      continue;
    }
    if (byte === 0x22) { text += '"'; quoted = true; continue; }
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
  return text;
}

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
  if (base !== undefined && (!Number.isInteger(base) || base < 0x100 || base >= 0xc000)) throw new RangeError('baseAddress must be 256..49151');
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
    for (const style of styled.styles) {
      const end = style.literalOffset + style.attributes.length;
      if (style.literalOffset === 0 || end >= tokens.length || tokens[style.literalOffset - 1] !== 0x22 || tokens[end] !== 0x22) {
        throw new BasicProgramError('BASIC style record does not describe a quoted literal');
      }
    }
    const nextOffset = styled.nextOffset;
    const nextAddress = lo | (hi << 8);
    if (nextAddress !== 0xffff) relocatableLinks = false;
    if (base !== undefined && nextAddress !== base + nextOffset) throw new BasicProgramError('BASIC forward link does not match baseAddress');
    lines.push({number: lineNumber, text: decodeTokenBody(tokens), offset, nextAddress, tokens, styles: styled.styles});
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
