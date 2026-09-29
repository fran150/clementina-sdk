import {tokenizeBasicLineWithSpans} from '@clementina/basic';
import {basicFunctionKeywords, basicSignatureByKeyword, basicStatementKeywords} from './catalog.js';
import {functionCallOpen} from './calls.js';
import {completionsFor} from './keywords.js';
import {analyzeProgramLines, assertSourcePosition, parsedPhysicalLine, splitPhysicalLines, variableOccurrences} from './source.js';
import type {BasicCompletionItem, BasicSemanticSpan, BasicSignatureHelp} from './types.js';

const EXPRESSION_KEYWORDS = new Set(['AND', 'OR', 'NOT', 'TO', 'STEP', 'THEN']);
const OPERATOR_KEYWORDS = new Set(['+', '-', '*', '/', '^', 'AND', 'OR', '>', '=', '<', 'NOT']);

/** Complete statements or expressions at a one-based line and zero-based column. */
export function completionsAt(text: string, line: number, character: number): BasicCompletionItem[] {
  const raw = splitPhysicalLines(text)[line - 1] ?? '';
  const before = raw.slice(0, character);
  const prefix = /[A-Za-z][A-Za-z0-9]*[$%]?$/u.exec(before)?.[0] ?? '';
  const numberedPrefix = /^\s*[0-9]+\s*/u.exec(before);
  const statementText = numberedPrefix ? before.slice(numberedPrefix[0].length) : before;
  const segment = statementText.slice(statementText.lastIndexOf(':') + 1);
  const statementPosition = /^\s*[A-Za-z]*$/u.test(segment);
  const keywords = completionsFor(prefix).filter(item => statementPosition
    ? basicStatementKeywords.has(item.keyword)
    : basicFunctionKeywords.has(item.keyword) || EXPRESSION_KEYWORDS.has(item.keyword));
  if (statementPosition) return keywords;
  const variables = [...new Set(variableOccurrences(text).map(item => item.key))]
    .filter(name => name.startsWith(prefix.toUpperCase()))
    .map(keyword => ({keyword, category: 'variable' as const}));
  return [...keywords, ...variables].sort((a, b) => a.keyword.localeCompare(b.keyword));
}

/** Return tokenizer-derived semantic spans for effective program lines. */
export function semanticSpans(text: string): BasicSemanticSpan[] {
  const spans: BasicSemanticSpan[] = [];
  const document = analyzeProgramLines(text);
  const variables = variableOccurrences(text, document);
  spans.push(...variables.map(({name: _name, key: _key, ...location}) => ({...location, type: 'variable' as const})));
  for (const line of document.definitions.values()) {
    spans.push({type: 'number', line: line.physicalLine, startCharacter: line.numberStart, endCharacter: line.numberEnd});
    const {lexemes} = tokenizeBasicLineWithSpans(line.body);
    for (const lexeme of lexemes) {
      const location = {line: line.physicalLine, startCharacter: line.bodyStart + lexeme.start, endCharacter: line.bodyStart + lexeme.end};
      if (lexeme.keyword) spans.push({...location, type: OPERATOR_KEYWORDS.has(lexeme.keyword) ? 'operator' : 'keyword'});
      else if (lexeme.kind === 'literal' || lexeme.kind === 'data') spans.push({...location, type: 'string'});
      else if (lexeme.kind === 'remark') spans.push({...location, type: 'comment'});
    }
    const occupied = variables.filter(item => item.line === line.physicalLine);
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

/** Return the innermost function or current statement signature at a physical source position. */
export function signatureHelpAt(text: string, line: number, character: number): BasicSignatureHelp | undefined {
  assertSourcePosition(text, line, character);
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
    const open = functionCallOpen(parsed.body, lexeme);
    if (open === undefined || open >= bodyCursor) continue;
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
