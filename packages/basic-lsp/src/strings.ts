import {
  BASIC_STYLE_RAW_TILE,
  basicStyleFlags,
  formatBasicCharacter,
  formatBasicStyleTag,
  tokenizeBasicLineWithSpans,
  type BasicLineLexeme,
} from '@clementina/basic';
import {inkName} from './glyphs.js';
import {assertSourcePosition, parsedPhysicalLine, splitPhysicalLines} from './source.js';
import type {
  BasicSourceLocation, BasicSourcePosition, BasicSourceRange, BasicStringAnalysis, BasicStringCell, BasicStringHover,
  BasicStringSpan, BasicTagCompletion, BasicTagSpan, BasicTextEdit,
} from './types.js';

/** Collect quoted strings and tags on every valid numbered line, overridden ones included, since the editor shows them all. */
export function analyzeStrings(text: string): BasicStringAnalysis {
  const strings: BasicStringSpan[] = [], tags: BasicTagSpan[] = [];
  splitPhysicalLines(text).forEach((raw, index) => {
    const line = parsedPhysicalLine(raw, index + 1);
    if (!line || line.body === '') return;
    const at = (lexeme: BasicLineLexeme): BasicSourceLocation => ({
      line: line.physicalLine, startCharacter: line.bodyStart + lexeme.start, endCharacter: line.bodyStart + lexeme.end,
    });
    let open: BasicStringSpan | undefined, data = false;
    for (const lexeme of tokenizeBasicLineWithSpans(line.body).lexemes) {
      if (lexeme.keyword === 'DATA') data = true;
      else if (lexeme.kind === 'data' && lexeme.bytes[0] === 0x3a) data = false;
      if (lexeme.tag) {
        const tag: BasicTagSpan = {...at(lexeme), kind: lexeme.tag};
        if (lexeme.tag === 'character') tag.code = lexeme.bytes[0]!;
        else tag.attribute = lexeme.attribute!;
        tags.push(tag);
        open?.tags.push(tag);
      }
      if (lexeme.kind !== 'literal') continue;
      if (lexeme.bytes[0] === 0x22 && !lexeme.tag) {
        if (open) { open.endCharacter = at(lexeme).startCharacter; open = undefined; }
        else {
          open = {line: line.physicalLine, startCharacter: at(lexeme).endCharacter, endCharacter: raw.length, styled: false, data, cells: [], tags: []};
          strings.push(open);
        }
        continue;
      }
      if (lexeme.tag === 'style') continue;
      const cell: BasicStringCell = {...at(lexeme), code: lexeme.bytes[0]!, tagged: lexeme.tag === 'character'};
      if (lexeme.attribute !== undefined) cell.attribute = lexeme.attribute & ~BASIC_STYLE_RAW_TILE;
      open!.cells.push(cell);
      if (lexeme.attribute !== undefined) open!.styled = true;
    }
  });
  return {strings, tags};
}

/** True when a zero-based column lies within a span, its end included only when the span is empty. */
function within(location: BasicSourceLocation, line: number, character: number): boolean {
  return location.line === line && character >= location.startCharacter
    && (character < location.endCharacter || character === location.startCharacter);
}

/** Describe the tag, or the styled or tagged string, at a one-based line and zero-based column. */
export function stringHoverAt(text: string, line: number, character: number): BasicStringHover | undefined {
  assertSourcePosition(text, line, character);
  const analysis = analyzeStrings(text);
  const tag = analysis.tags.find(item => within(item, line, character));
  const string = analysis.strings.find(item => item.line === line && character >= item.startCharacter && character <= item.endCharacter);
  if (tag?.kind === 'character') return {kind: 'character', code: tag.code!, location: tag, ...(string ? {string} : {})};
  if (tag?.kind === 'style') {
    const next = string!.tags.find(item => item.kind === 'style' && item.startCharacter > tag.startCharacter);
    const styled = string!.cells.filter(cell => cell.startCharacter > tag.startCharacter && (!next || cell.startCharacter < next.startCharacter));
    return {kind: 'style', attribute: tag.attribute!, location: tag, styled};
  }
  if (string && (string.styled || string.tags.length > 0)) return {kind: 'string', string};
  return undefined;
}

/**
 * Offer tag words while the cursor is inside an unclosed `{` of a quoted string,
 * DATA or REM: characters `$01`-`$FF`, and in a quoted string the style words.
 * Returns undefined outside a tag, so callers can fall back to keyword completion.
 */
export function tagCompletionsAt(text: string, line: number, character: number): BasicTagCompletion[] | undefined {
  assertSourcePosition(text, line, character);
  const raw = splitPhysicalLines(text)[line - 1] ?? '';
  const numbered = /^\s*[0-9]+ */u.exec(raw);
  if (!numbered || character < numbered[0].length || character > raw.length) return undefined;
  const bodyStart = numbered[0].length;
  const before = raw.slice(bodyStart, character);
  const open = before.lastIndexOf('{');
  if (open === -1 || before.includes('}', open)) return undefined;
  let mode;
  try {
    mode = tokenizeBasicLineWithSpans(before.slice(0, open)).endMode;
  } catch {
    return undefined;
  }
  const typed = before.slice(open + 1);
  if (mode === 'code' || (mode === 'literal' && typed.includes('"'))) return undefined;
  const words = typed.split(/\s+/u);
  const current = words.pop()!, previous = words.filter(word => word !== '').map(word => word.toLowerCase());
  const range = {startCharacter: character - current.length, endCharacter: character};
  const items: BasicTagCompletion[] = [];
  if (previous.length === 0 && (current === '' || current.startsWith('$'))) {
    const close = raw[character] === '}' ? '' : '}';
    for (let code = 1; code < 0x100; code++) {
      if (code === 0x22) continue;
      const label = `$${code.toString(16).toUpperCase().padStart(2, '0')}`;
      const shown = formatBasicCharacter(code);
      items.push({label, kind: 'character', detail: shown.startsWith('{') ? `tile ${label}` : `tile ${label} (${shown})`, newText: label + close, code, ...range});
    }
  }
  if (mode === 'literal' && !current.startsWith('$') && !previous.some(word => word.startsWith('$'))) {
    if (!previous.some(word => /^c[0-9]+$/u.test(word))) {
      for (let bank = 0; bank < 16; bank++) items.push({label: `c${bank}`, kind: 'color', detail: `color ${bank}: ${inkName(bank)}`, newText: `c${bank}`, attribute: bank, ...range});
    }
    for (const flag of basicStyleFlags) {
      if (!previous.includes(flag.word)) items.push({label: flag.word, kind: 'flag', detail: flag.label, newText: flag.word, attribute: flag.bit, ...range});
    }
  }
  return items;
}

/** Compare one-based line, zero-based column positions. */
function precedes(a: BasicSourcePosition, b: BasicSourcePosition): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

/**
 * Give the selected characters of quoted strings one attribute, or with
 * `attribute` null remove every style from the strings the selections touch.
 * An empty selection means the whole string it is in. Characters of a formerly
 * unstyled string outside the selection take attribute $00, since a string is
 * styled as a whole. Each edit rewrites one string's content canonically.
 */
export function restyleStrings(text: string, selections: readonly BasicSourceRange[], attribute: number | null): BasicTextEdit[] {
  if (attribute !== null && (!Number.isInteger(attribute) || attribute < 0 || attribute > 0xff || attribute & BASIC_STYLE_RAW_TILE)) {
    throw new RangeError('attribute must be a byte without the raw-tile bit $40');
  }
  const edits: BasicTextEdit[] = [];
  for (const string of analyzeStrings(text).strings) {
    const start = {line: string.line, character: string.startCharacter}, end = {line: string.line, character: string.endCharacter};
    const selected = string.cells.map(cell => selections.some(selection => {
      if (!precedes(selection.start, selection.end)) return !precedes(selection.start, start) && !precedes(end, selection.start);
      return precedes(selection.start, {line: cell.line, character: cell.endCharacter}) && precedes({line: cell.line, character: cell.startCharacter}, selection.end);
    }));
    if (!selected.some(Boolean)) continue;
    let content = '';
    if (attribute === null) content = string.cells.map(cell => formatBasicCharacter(cell.code)).join('');
    else {
      let previous: number | undefined;
      string.cells.forEach((cell, index) => {
        const next = selected[index] ? attribute : cell.attribute ?? 0;
        if (next !== previous) content += formatBasicStyleTag(next);
        previous = next;
        content += formatBasicCharacter(cell.code);
      });
    }
    const current = splitPhysicalLines(text)[string.line - 1]!.slice(string.startCharacter, string.endCharacter);
    if (content !== current) edits.push({line: string.line, startCharacter: string.startCharacter, endCharacter: string.endCharacter, newText: content});
  }
  return edits;
}
