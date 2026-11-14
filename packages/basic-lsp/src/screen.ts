import {
  BASIC_STYLE_COLOR_MASK,
  BASIC_STYLE_FLIP_X,
  BASIC_STYLE_FLIP_Y,
  BASIC_STYLE_RAW_TILE,
  BASIC_STYLE_REVERSE,
  tokenizeBasicLineWithSpans,
  type BasicLineLexeme,
} from '@clementina/basic';
import {consoleControlCodes} from './charset-data.js';
import {parsedPhysicalLine, splitPhysicalLines} from './source.js';
import type {BasicScreenCell, BasicScreenNote, BasicScreenPlaceholder, BasicScreenPreview} from './types.js';

// The overlay console and BASIC's PRINT as clementina-rom runs them: the screen
// size is CRSR's range and the zone width PRINT's comma in specs/basic.json, and
// the control codes are KERN_CHROUT's in specs/kernel-abi.json.
const COLUMNS = 40, ROWS = 25, ZONE = 14;
const SPACE = 0x20, CR = 0x0d, LF = 0x0a;
/** ATTR_WHITE: the editor pen (TEXT_ATTR) and BASIC pen at startup, palette 0 with no flips or reverse. */
const STARTUP_PEN = 0;
/** DISPLAY_ATTR_MASK: the attribute bits the overlay keeps, without BASIC's raw-tile marker. */
const DISPLAY_MASK = 0xff & ~BASIC_STYLE_RAW_TILE;
const controlSymbols = new Map(consoleControlCodes.map(item => [item.code, item.symbol]));
const FORM_FEED = consoleControlCodes.find(item => item.symbol === 'CHR_FF')!.code;

/** A cleared cell: clrscr and scroll_up write spaces in TEXT_ATTR, never reversed. */
const blank = (attribute: number): BasicScreenCell => ({code: SPACE, attribute: attribute & DISPLAY_MASK & ~BASIC_STYLE_REVERSE});
const blankRows = (attribute: number): BasicScreenCell[][] => Array.from({length: ROWS}, () => Array.from({length: COLUMNS}, () => blank(attribute)));

/** The overlay text console and the BASIC state PRINT reads. */
class Screen {
  rows = blankRows(STARTUP_PEN);
  x = 0;
  y = 0;
  /** POSX, BASIC's output column: a byte only a line end, CLS or CRSR resets, so it runs on past a wrapped row. */
  column = 0;
  /** BASIC_DEFAULT_ATTR: COLOR, FLIPX, FLIPY and ALT set it, and numbers and unstyled strings print in it. */
  pen = STARTUP_PEN;
  /** BASIC_STYLE_MASK: the attribute fields styled strings take from the pen instead of their own. */
  styleMask = 0;
  /** TEXT_ATTR, which the console draws with: the editor pen between strings. */
  textAttribute = STARTUP_PEN;
  backdrop: number | undefined;
  /** The run-time value being drawn as its source text. */
  placeholder: number | undefined;
  placeholders = 0;
  /** The lowest row drawn on; scrolling moves it up with the text. */
  bottom = -1;

  /** put_glyph_raw: draw a tile at the cursor and advance, wrapping and scrolling at the edges. */
  draw(code: number): void {
    const cell: BasicScreenCell = {code, attribute: this.textAttribute & DISPLAY_MASK};
    if (this.placeholder !== undefined) cell.placeholder = this.placeholder;
    this.rows[this.y]![this.x] = cell;
    this.bottom = Math.max(this.bottom, this.y);
    if (++this.x === COLUMNS) {
      this.x = 0;
      this.newline();
    }
  }

  /** newline: move down a row, scrolling the screen up from the bottom one. */
  newline(): void {
    if (++this.y < ROWS) return;
    this.y = ROWS - 1;
    this.rows.shift();
    this.rows.push(Array.from({length: COLUMNS}, () => blank(this.textAttribute)));
    this.bottom--;
  }

  /** KERN_CHROUT: act on a console control code, or draw any other code as its glyph. Cursor moves never scroll. */
  chrout(code: number): void {
    switch (controlSymbols.get(code)) {
      case 'CHR_CR': this.x = 0; this.newline(); return;
      case 'CHR_LF': return;
      case 'CHR_BS':
        if (this.x > 0) this.rows[this.y]![--this.x] = blank(this.textAttribute);
        return;
      case 'CHR_FF': this.rows = blankRows(this.textAttribute); this.x = this.y = 0; this.bottom = -1; return;
      case 'CHR_HOME': this.x = this.y = 0; return;
      case 'CHR_CRSR_UP': if (this.y > 0) this.y--; return;
      case 'CHR_CRSR_DOWN': if (this.y < ROWS - 1) this.y++; return;
      case 'CHR_CRSR_LEFT':
        if (this.x > 0) this.x--;
        else if (this.y > 0) { this.y--; this.x = COLUMNS - 1; }
        return;
      case 'CHR_CRSR_RIGHT':
        if (this.x < COLUMNS - 1) this.x++;
        else if (this.y < ROWS - 1) { this.y++; this.x = 0; }
        return;
      default: this.draw(code);
    }
  }

  /** OUTDO: send a code to the console, counting a column for each code from $20 up. */
  outdo(code: number): void {
    if (code >= SPACE) this.column = (this.column + 1) & 0xff;
    this.chrout(code);
  }

  /** OUTSP: the spaces PRINT writes after a number and for commas, TAB and SPC, in the editor pen. */
  space(count = 1): void {
    for (let index = 0; index < count; index++) this.outdo(SPACE);
  }

  /** CRDO: end the output line. */
  lineEnd(): void {
    this.outdo(CR);
    this.outdo(LF);
    this.column = 0;
  }

  /** STRPRT_STYLED's @lit path: unstyled strings and numbers print in the pen, and their control codes act. */
  printPlain(codes: readonly number[]): void {
    const saved = this.textAttribute;
    this.textAttribute = this.pen;
    for (const code of codes) {
      this.outdo(code);
      if (code === CR) this.column = 0;
    }
    this.textAttribute = saved;
  }

  /** STRPRT_STYLED's @heap path: each character in its stored attribute, but for the fields STYLE gives the pen. */
  printStyled(cells: readonly {code: number; attribute: number}[]): void {
    const saved = this.textAttribute;
    for (const {code, attribute} of cells) {
      this.textAttribute = (attribute & ~this.styleMask) | (this.pen & this.styleMask);
      // styled_outc: a raw tile, or any code outside $20-$7E but an untagged CR, draws as its glyph.
      if (this.textAttribute & BASIC_STYLE_RAW_TILE || (code !== CR && (code < SPACE || code >= 0x7f))) {
        this.draw(code);
        this.column = (this.column + 1) & 0xff;
      } else {
        this.outdo(code);
        if (code === CR) this.column = 0;
      }
    }
    this.textAttribute = saved;
  }
}

/** A string literal from its opening quote through its closing one, or one other lexeme. */
type Unit = {kind: 'string'; lexemes: BasicLineLexeme[]} | {kind: 'lexeme'; lexeme: BasicLineLexeme};

type PrintItem =
  | {kind: 'comma' | 'semicolon'}
  | {kind: 'TAB(' | 'SPC('; lexemes: BasicLineLexeme[]}
  | {kind: 'value'; units: Unit[]};

/** Binary operators, after which a PRINT value goes on. */
const OPERATORS = new Set(['+', '-', '*', '/', '^', 'AND', 'OR', '>', '=', '<']);

const isText = (lexeme: BasicLineLexeme, character: string): boolean => lexeme.kind === 'text' && lexeme.bytes.length === 1 && lexeme.bytes[0] === character.charCodeAt(0);
const isQuote = (lexeme: BasicLineLexeme): boolean => lexeme.kind === 'literal' && !lexeme.tag && lexeme.bytes[0] === 0x22;
const opens = (lexeme: BasicLineLexeme): boolean => isText(lexeme, '(') || lexeme.keyword?.endsWith('(') === true;
/** The lexemes CHRGET reads: all but the spaces between them. */
const significant = (lexemes: readonly BasicLineLexeme[]): BasicLineLexeme[] => lexemes.filter(lexeme => !isText(lexeme, ' '));
const character = (lexeme: BasicLineLexeme, at: number): string => String.fromCharCode(lexeme.bytes.at(at)!);
const unitStart = (unit: Unit): number => (unit.kind === 'string' ? unit.lexemes[0]! : unit.lexeme).start;
const unitEnd = (unit: Unit): number => (unit.kind === 'string' ? unit.lexemes.at(-1)! : unit.lexeme).end;

/** A line's lexemes as statements: split at colons, and after THEN. */
function statements(lexemes: readonly BasicLineLexeme[]): BasicLineLexeme[][] {
  const result: BasicLineLexeme[][] = [[]];
  for (const lexeme of lexemes) {
    if ((lexeme.kind === 'text' || lexeme.kind === 'data') && lexeme.bytes[0] === 0x3a) result.push([]);
    else {
      result.at(-1)!.push(lexeme);
      if (lexeme.keyword === 'THEN') result.push([]);
    }
  }
  return result.map(significant);
}

/** A decimal constant's value, or undefined for anything only the running program knows. */
function constantOf(lexemes: readonly BasicLineLexeme[]): number | undefined {
  const digits = significant(lexemes).map(lexeme => (lexeme.kind === 'text' && lexeme.bytes.length === 1 ? character(lexeme, 0) : ''));
  return digits.length && digits.every(digit => digit >= '0' && digit <= '9' && digit !== '') ? Number(digits.join('')) : undefined;
}

/** Split argument lexemes at their top-level commas. */
function argumentsOf(lexemes: readonly BasicLineLexeme[]): BasicLineLexeme[][] {
  const result: BasicLineLexeme[][] = [[]];
  let depth = 0;
  for (const lexeme of lexemes) {
    if (opens(lexeme)) depth++;
    else if (isText(lexeme, ')')) depth--;
    if (depth === 0 && isText(lexeme, ',')) result.push([]);
    else result.at(-1)!.push(lexeme);
  }
  return result;
}

/**
 * True when `next` starts another PRINT value right after `previous` with no
 * separator, as in `"A"B$` or `A$"X"`: where the ROM's expression evaluator stops.
 */
function juxtaposed(previous: Unit, next: Unit): boolean {
  // A keyword is an operator or a function that still needs its operand.
  if (previous.kind === 'lexeme' && previous.lexeme.kind !== 'text') return false;
  const last = previous.kind === 'string' ? '"' : character(previous.lexeme, -1);
  if (!/["A-Z0-9.$%)]/u.test(last)) return false;
  if (next.kind === 'string') return true;
  if (next.lexeme.kind === 'keyword') return !OPERATORS.has(next.lexeme.keyword!);
  // Letters and digits continue a name or number, since CHRGET skips the spaces between them.
  return /[A-Z0-9.$]/u.test(character(next.lexeme, 0)) && /["$%)]/u.test(last);
}

/** Split a PRINT statement's lexemes after the keyword into its values and separators. */
function printItems(lexemes: readonly BasicLineLexeme[]): PrintItem[] {
  const items: PrintItem[] = [];
  let value: Unit[] | undefined, depth = 0;
  const endValue = (): void => {
    if (value) items.push({kind: 'value', units: value});
    value = undefined;
  };
  const add = (unit: Unit): void => {
    if (value && depth === 0 && juxtaposed(value.at(-1)!, unit)) endValue();
    (value ??= []).push(unit);
  };
  for (let index = 0; index < lexemes.length; index++) {
    const lexeme = lexemes[index]!;
    if (isQuote(lexeme)) {
      const string = [lexeme];
      while (index + 1 < lexemes.length) {
        const next = lexemes[++index]!;
        string.push(next);
        if (isQuote(next)) break;
      }
      add({kind: 'string', lexemes: string});
      continue;
    }
    if (depth === 0 && (isText(lexeme, ',') || isText(lexeme, ';'))) {
      endValue();
      items.push({kind: isText(lexeme, ',') ? 'comma' : 'semicolon'});
      continue;
    }
    if (depth === 0 && (lexeme.keyword === 'TAB(' || lexeme.keyword === 'SPC(')) {
      endValue();
      const spacing = [lexeme];
      for (let inner = 1; inner > 0 && ++index < lexemes.length;) {
        const next = lexemes[index]!;
        spacing.push(next);
        if (opens(next)) inner++;
        else if (isText(next, ')')) inner--;
      }
      items.push({kind: lexeme.keyword, lexemes: spacing});
      continue;
    }
    add({kind: 'lexeme', lexeme});
    if (opens(lexeme)) depth++;
    else if (isText(lexeme, ')') && depth > 0) depth--;
  }
  endValue();
  return items;
}

/** Whether a PRINT value is a string: no comparison at its top level, and a string literal, string function or `$` variable first. */
function isStringValue(units: readonly Unit[]): boolean {
  let depth = 0;
  for (const unit of units) {
    if (unit.kind === 'string') continue;
    if (opens(unit.lexeme)) depth++;
    else if (isText(unit.lexeme, ')')) depth--;
    else if (depth === 0 && ['=', '<', '>'].includes(unit.lexeme.keyword ?? '')) return false;
  }
  const first = units[0]!;
  if (first.kind === 'string') return true;
  if (first.lexeme.keyword) return first.lexeme.keyword.endsWith('$');
  for (const unit of units) {
    if (unit.kind !== 'lexeme' || unit.lexeme.kind !== 'text' || unit.lexeme.bytes.length !== 1) return false;
    const letter = character(unit.lexeme, 0);
    if (letter === '$') return unit !== first;
    if (!/[A-Z0-9]/u.test(letter)) return false;
  }
  return false;
}

const codesOf = (text: string): number[] => [...text].map(letter => letter.charCodeAt(0));

/** Print one PRINT value: a lone string literal or small decimal constant as itself, anything else as its source text. */
function printValue(screen: Screen, units: readonly Unit[], body: string): void {
  const only = units.length === 1 ? units[0]! : undefined;
  if (only?.kind === 'string') {
    const characters = only.lexemes.filter(lexeme => !isQuote(lexeme) && lexeme.tag !== 'style');
    if (characters.some(lexeme => lexeme.attribute !== undefined)) {
      screen.printStyled(characters.map(lexeme => ({code: lexeme.bytes[0]!, attribute: lexeme.attribute!})));
    } else {
      screen.printPlain(characters.map(lexeme => lexeme.bytes[0]!));
    }
    return;
  }
  // FOUT writes a sign (a space when positive) before the digits, and PRINT a space after them.
  const lexemes = units.flatMap(unit => (unit.kind === 'lexeme' ? [unit.lexeme] : []));
  const negative = lexemes[0]?.keyword === '-';
  const number = lexemes.length === units.length ? constantOf(negative ? lexemes.slice(1) : lexemes) : undefined;
  if (number !== undefined && number < 1e6) {
    screen.printPlain(codesOf(`${negative && number ? '-' : ' '}${number}`));
    screen.space();
    return;
  }
  const numeric = !isStringValue(units);
  if (numeric) screen.printPlain([SPACE]);
  screen.placeholder = ++screen.placeholders;
  screen.printPlain(codesOf(body.slice(unitStart(units[0]!), unitEnd(units.at(-1)!))));
  screen.placeholder = undefined;
  if (numeric) screen.space();
}

/** Run a PRINT statement's lexemes after the keyword. */
function print(screen: Screen, lexemes: readonly BasicLineLexeme[], body: string, note: (message: string) => void): void {
  let lineEnd = true;
  for (const item of printItems(lexemes)) {
    // A trailing separator, TAB or SPC keeps the cursor on the line.
    lineEnd = item.kind === 'value';
    if (item.kind === 'comma') screen.space(ZONE - (screen.column % ZONE));
    else if (item.kind === 'value') printValue(screen, item.units, body);
    else if (item.kind === 'TAB(' || item.kind === 'SPC(') {
      const source = body.slice(item.lexemes[0]!.start, item.lexemes.at(-1)!.end);
      const count = constantOf(item.lexemes.slice(1, -1));
      if (count === undefined) note(`${source} is only known when the program runs, so nothing is printed for it.`);
      else if (count > 0xff) note(`${source} is out of range: the program stops here with ILLEGAL QUANTITY.`);
      else screen.space(item.kind === 'SPC(' ? count : Math.max(0, count - screen.column));
    }
  }
  if (lineEnd) screen.lineEnd();
}

/** Set or clear a pen bit, as FLIPX, FLIPY and ALT do. */
const penBit = (bit: number) => (screen: Screen, [enabled]: number[]): void => {
  screen.pen = enabled ? screen.pen | bit : screen.pen & ~bit;
};

/** STYLE's argument bits and the attribute field each one gives the pen. */
const styleFields = [[1, BASIC_STYLE_COLOR_MASK], [2, BASIC_STYLE_FLIP_X], [4, BASIC_STYLE_FLIP_Y], [8, BASIC_STYLE_REVERSE]] as const;

/** Statements besides PRINT and CLS that change what later output looks like: each argument's highest value, and what an unknown one leaves. */
const settings = new Map<string, {max: number[]; unknown: string; apply: (screen: Screen, values: number[]) => void}>([
  ['COLOR', {max: [15], unknown: 'the BASIC pen keeps its color', apply: (screen, [bank]) => { screen.pen = (screen.pen & 0xb0) | bank!; }}],
  ['FLIPX', {max: [0xff], unknown: 'the BASIC pen keeps its flip', apply: penBit(BASIC_STYLE_FLIP_X)}],
  ['FLIPY', {max: [0xff], unknown: 'the BASIC pen keeps its flip', apply: penBit(BASIC_STYLE_FLIP_Y)}],
  ['ALT', {max: [0xff], unknown: 'the BASIC pen keeps its reverse', apply: penBit(BASIC_STYLE_REVERSE)}],
  ['STYLE', {max: [15], unknown: 'styled strings keep the fields they took from the pen', apply: (screen, [mask]) => {
    screen.styleMask = styleFields.reduce((fields, [bit, field]) => (mask! & bit ? fields | field : fields), 0);
  }}],
  ['CRSR', {max: [COLUMNS - 1, ROWS - 1], unknown: 'the cursor stays where it was', apply: (screen, [column, row]) => {
    screen.x = screen.column = column!;
    screen.y = row!;
  }}],
  ['BCOLOR', {max: [15], unknown: 'the backdrop keeps its color', apply: (screen, [bank]) => { screen.backdrop = bank; }}],
]);

/** Run one statement if it prints or changes how printing looks. */
function run(screen: Screen, lexemes: readonly BasicLineLexeme[], body: string, note: (message: string) => void): void {
  const [head, ...rest] = lexemes;
  if (head?.kind !== 'keyword') return;
  if (head.keyword === 'PRINT') return print(screen, rest, body, note);
  if (head.keyword === 'CLS') {
    screen.column = 0;
    screen.chrout(FORM_FEED);
    return;
  }
  const setting = settings.get(head.keyword!);
  if (!setting) return;
  const values = argumentsOf(rest).map(constantOf);
  // A wrong argument count is a syntax error, which diagnostics report.
  if (values.length !== setting.max.length) return;
  const source = body.slice(head.start, lexemes.at(-1)!.end);
  if (values.some(value => value === undefined)) note(`${source} is only known when the program runs, so ${setting.unknown}.`);
  else if (values.some((value, index) => value! > setting.max[index]!)) note(`${source} is out of range: the program stops here with ILLEGAL QUANTITY.`);
  else setting.apply(screen, values as number[]);
}

/** Runs of cells on each row that show the same placeholder. */
function placeholderRuns(rows: readonly (readonly BasicScreenCell[])[]): BasicScreenPlaceholder[] {
  const runs: BasicScreenPlaceholder[] = [];
  rows.forEach((cells, row) => cells.forEach((cell, column) => {
    if (cell.placeholder === undefined) return;
    const run = runs.at(-1);
    if (run?.row === row && run.endColumn === column && cells[column - 1]!.placeholder === cell.placeholder) run.endColumn++;
    else runs.push({row, startColumn: column, endColumn: column + 1});
  }));
  return runs;
}

/**
 * Run the output statements of some one-based physical lines in source order,
 * on a cleared screen in the startup pens: PRINT, CLS, CRSR, COLOR, FLIPX,
 * FLIPY, ALT, STYLE and BCOLOR. Control flow is ignored, so a PRINT after THEN
 * always runs. A value only the running program knows prints as its source
 * text in placeholder cells, with the spaces the ROM puts around a number.
 */
export function previewScreen(text: string, lines: readonly number[]): BasicScreenPreview {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const physical = splitPhysicalLines(text);
  const screen = new Screen();
  const ran: number[] = [], notes: BasicScreenNote[] = [];
  for (const index of [...new Set(lines)].sort((a, b) => a - b)) {
    const raw = Number.isInteger(index) && index >= 1 ? physical[index - 1] : undefined;
    const line = raw === undefined ? undefined : parsedPhysicalLine(raw, index);
    if (!line || line.body === '') continue;
    ran.push(line.number);
    const note = (message: string): void => { notes.push({line: index, number: line.number, message}); };
    for (const statement of statements(tokenizeBasicLineWithSpans(line.body).lexemes)) run(screen, statement, line.body, note);
  }
  const rows = screen.rows.slice(0, screen.bottom + 1);
  return {lines: ran, rows, ...(screen.backdrop === undefined ? {} : {backdrop: screen.backdrop}), placeholders: placeholderRuns(rows), notes};
}
