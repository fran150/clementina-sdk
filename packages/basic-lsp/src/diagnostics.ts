import {BasicProgramError, compileBasicProgram, parseBasicSource, tokenizeBasicLineWithSpans} from '@clementina/basic';
import {basicFunctionKeywords, basicSignatureByKeyword} from './catalog.js';
import {functionCallOpen} from './calls.js';
import {analyzeProgramLines, splitPhysicalLines, type ProgramLine} from './source.js';
import type {BasicLspDiagnostic} from './types.js';

/** Check whether every character is printable 7-bit ASCII. */
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

  const document = analyzeProgramLines(text);
  for (const reference of document.references) {
    if (!document.definitions.has(reference.target)) {
      diagnostics.push({
        line: reference.line,
        startCharacter: reference.startCharacter,
        endCharacter: reference.endCharacter,
        message: `${reference.keyword} target line ${reference.target} does not exist`,
        code: 'basic.target',
      });
    }
  }
  for (const line of document.definitions.values()) diagnostics.push(...syntaxDiagnosticsForLine(line));

  return diagnostics.sort((a, b) => a.line - b.line || (a.startCharacter ?? 0) - (b.startCharacter ?? 0));
}

/** Report unmatched parentheses and known function argument counts for one line. */
function syntaxDiagnosticsForLine(line: ProgramLine): BasicLspDiagnostic[] {
  const {lexemes} = tokenizeBasicLineWithSpans(line.body);
  const diagnostics: BasicLspDiagnostic[] = [];
  const protectedAt = new Set<number>();
  for (const lexeme of lexemes) {
    if (lexeme.kind === 'literal' || lexeme.kind === 'data' || lexeme.kind === 'remark') {
      for (let at = lexeme.start; at < lexeme.end; at++) protectedAt.add(at);
    }
  }
  const stack: number[] = [];
  for (let at = 0; at < line.body.length; at++) {
    if (protectedAt.has(at)) continue;
    if (line.body[at] === '(') stack.push(at);
    else if (line.body[at] === ')') {
      if (stack.length) stack.pop();
      else diagnostics.push({line: line.physicalLine, startCharacter: line.bodyStart + at, endCharacter: line.bodyStart + at + 1, message: 'Unmatched closing parenthesis', code: 'basic.syntax'});
    }
  }
  for (const at of stack) diagnostics.push({line: line.physicalLine, startCharacter: line.bodyStart + at, endCharacter: line.bodyStart + at + 1, message: 'Unmatched opening parenthesis', code: 'basic.syntax'});

  for (const lexeme of lexemes) {
    if (!lexeme.keyword || !basicFunctionKeywords.has(lexeme.keyword)) continue;
    const signature = basicSignatureByKeyword.get(lexeme.keyword)!;
    const open = functionCallOpen(line.body, lexeme);
    if (open === undefined) continue;
    let depth = 1, commas = 0, close = -1, hasArgument = false;
    for (let at = open + 1; at < line.body.length; at++) {
      if (protectedAt.has(at)) { hasArgument = true; continue; }
      const char = line.body[at]!;
      if (char === '(') { depth++; hasArgument = true; }
      else if (char === ')') { if (--depth === 0) { close = at; break; } }
      else if (char === ',' && depth === 1) commas++;
      else if (char !== ' ') hasArgument = true;
    }
    if (close === -1) continue;
    const count = hasArgument ? commas + 1 : 0;
    const required = signature.parameters.filter(parameter => !parameter.endsWith('?')).length;
    if (count < required || count > signature.parameters.length) {
      diagnostics.push({
        line: line.physicalLine, startCharacter: line.bodyStart + lexeme.start, endCharacter: line.bodyStart + close + 1,
        message: `${lexeme.keyword.replace(/\($/u, '')} expects ${required === signature.parameters.length ? required : `${required}..${signature.parameters.length}`} argument(s), found ${count}`,
        code: 'basic.syntax',
      });
    }
  }
  return diagnostics;
}
