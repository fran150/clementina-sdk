import {basicTokenTables} from '@clementina/basic';
import {formatHex} from '@clementina/core';
import {assertSourcePosition, splitPhysicalLines} from './source.js';
import type {BasicCompletionItem, BasicHoverInfo, BasicKeywordCategory} from './types.js';

const KEYWORD_CHAR = /[A-Za-z]/u;

/** Read the ASCII letter run touching a zero-based source column. */
function wordAt(lineText: string, character: number): {word: string; end: number} | undefined {
  if (character < 0 || character > lineText.length) return undefined;
  let start = character, end = character;
  while (start > 0 && KEYWORD_CHAR.test(lineText[start - 1]!)) start--;
  while (end < lineText.length && KEYWORD_CHAR.test(lineText[end]!)) end++;
  if (start === end) return undefined;
  return {word: lineText.slice(start, end).toUpperCase(), end};
}

const PREFIXED_TABLES: ReadonlyArray<{category: 'extensionFunction' | 'extension' | 'extension2'; list: readonly string[]; prefix: number}> = [
  {category: 'extensionFunction', list: basicTokenTables.extensionFunction, prefix: basicTokenTables.extensionFunctionPrefix},
  {category: 'extension', list: basicTokenTables.extension, prefix: basicTokenTables.extensionPrefix},
  {category: 'extension2', list: basicTokenTables.extension2, prefix: basicTokenTables.extension2Prefix},
];

/** Look up an exact keyword using the ROM tokenizer's table search order. */
function findKeyword(word: string): BasicHoverInfo | undefined {
  if (word === 'MON') return {keyword: 'MON', category: 'special', token: formatHex(basicTokenTables.mon, 2)};
  for (const table of PREFIXED_TABLES) {
    const index = table.list.indexOf(word);
    if (index !== -1) {
      return {keyword: word, category: table.category, token: `${formatHex(table.prefix, 2)},${formatHex(basicTokenTables.extensionSubtokenStart + index, 2)}`};
    }
  }
  const primaryIndex = (basicTokenTables.primary as readonly string[]).indexOf(word);
  if (primaryIndex !== -1) return {keyword: word, category: 'primary', token: formatHex(basicTokenTables.primaryStart + primaryIndex, 2)};
  return undefined;
}

/**
 * Look up a token name at a physical source position. `line` is one-based and
 * `character` is a zero-based column. Returns undefined outside known keywords.
 * A trailing `$`/`(` is only ever part of the keyword itself for entries like
 * `STR$`/`TAB(` — try that form first, then fall back to the bare word, rather
 * than assuming every following `(` (e.g. any `CUE(0)` function call) belongs
 * to the keyword.
 */
export function hoverAt(text: string, line: number, character: number): BasicHoverInfo | undefined {
  assertSourcePosition(text, line, character);
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

/** Return all ROM keywords starting with a case-insensitive prefix, without duplicates. */
export function completionsFor(prefix: string): BasicCompletionItem[] {
  if (typeof prefix !== 'string') throw new TypeError('prefix must be a string');
  const upper = prefix.toUpperCase();
  const seen = new Set<string>();
  const items: BasicCompletionItem[] = [];
  /** Add a matching keyword once, preserving its tokenizer category. */
  const add = (keyword: string, category: BasicKeywordCategory): void => {
    if (seen.has(keyword) || !keyword.startsWith(upper)) return;
    seen.add(keyword);
    items.push({keyword, category});
  };
  add('MON', 'special');
  for (const table of PREFIXED_TABLES) for (const keyword of table.list) add(keyword, table.category);
  for (const keyword of basicTokenTables.primary) add(keyword, 'primary');
  return items.sort((a, b) => a.keyword.localeCompare(b.keyword));
}
