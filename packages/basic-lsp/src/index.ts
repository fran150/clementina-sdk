import {
  BasicProgramError,
  basicTokenTables,
  compileBasicProgram,
  parseBasicSource,
} from '@clementina/basic';

export type BasicKeywordCategory = 'primary' | 'extension' | 'extension2' | 'extensionFunction' | 'special';

export interface BasicLspDiagnostic {
  /** 1-based physical source line, matching BasicProgramError.sourceLine. */
  line: number;
  message: string;
  code: 'basic.parse' | 'basic.compile';
}

export interface BasicHoverInfo {
  keyword: string;
  category: BasicKeywordCategory;
  /** Hex byte(s), e.g. "$89" for a primary token or "$FF,$A0" for a prefixed one. */
  token: string;
}

export interface BasicCompletionItem {
  keyword: string;
  category: BasicKeywordCategory;
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

  return diagnostics.sort((a, b) => a.line - b.line);
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
