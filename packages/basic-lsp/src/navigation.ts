import {basicSourceLimits, tokenizeBasicLineWithSpans} from '@clementina/basic';
import {analyzeProgramLines, assertSourcePosition, variableOccurrences} from './source.js';
import type {BasicDefinition, BasicDocumentSymbol, BasicSourceLocation, BasicTextEdit} from './types.js';

/** Resolve a static target at a one-based line and zero-based column to its effective definition. */
export function definitionAt(text: string, line: number, character: number): BasicDefinition | undefined {
  assertSourcePosition(text, line, character);
  const document = analyzeProgramLines(text);
  const reference = document.references.find(item => item.line === line && character >= item.startCharacter && character < item.endCharacter);
  if (!reference) return undefined;
  const target = document.definitions.get(reference.target);
  return target && {line: target.physicalLine, startCharacter: target.numberStart, endCharacter: target.numberEnd};
}

type SymbolAt = {kind: 'line'; value: number} | {kind: 'variable'; value: string};

/** Identify the effective line number or ROM-significant variable at a position. */
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

/** Find symbol occurrences at a one-based line and zero-based column; include line declarations by default. */
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

/** Return validated edits for a variable or effective line and its static targets; throw for invalid names. */
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

/** List effective numbered lines and the first occurrence of each variable key. */
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
