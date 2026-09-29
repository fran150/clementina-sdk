import {BasicProgramError, parseBasicSource, tokenizeBasicLineWithSpans} from '@clementina/basic';
import type {BasicSourceLocation} from './types.js';

/** Split CR, LF, or CRLF source while retaining a final empty physical line. */
export function splitPhysicalLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').split('\n');
}

/** Validate the one-based line and zero-based column used by cursor APIs. */
export function assertSourcePosition(text: string, line: number, character: number): void {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!Number.isInteger(line) || line < 1) throw new RangeError('line must be a positive integer');
  if (!Number.isInteger(character) || character < 0) throw new RangeError('character must be a non-negative integer');
}

/** Effective numbered line with offsets into its physical source line. */
export interface ProgramLine {
  physicalLine: number;
  number: number;
  numberStart: number;
  numberEnd: number;
  body: string;
  bodyStart: number;
}

interface LineReference {
  line: number;
  target: number;
  keyword: string;
  startCharacter: number;
  endCharacter: number;
}

interface VariableOccurrence extends BasicSourceLocation {name: string; key: string}

/** Effective numbered lines and their static line-number references. */
export interface ProgramDocument {
  definitions: Map<number, ProgramLine>;
  references: LineReference[];
}

/** Return the ROM-significant first two letters and optional type suffix. */
function variableKey(name: string): string {
  const upper = name.toUpperCase();
  const suffix = upper.endsWith('$') || upper.endsWith('%') ? upper.at(-1)! : '';
  return upper.slice(0, Math.min(2, upper.length - suffix.length)) + suffix;
}

/** Parse one valid numbered source line and retain its physical text offsets. */
export function parsedPhysicalLine(raw: string, physicalLine: number): ProgramLine | undefined {
  const match = /^(\s*)([0-9]+)(.*)$/u.exec(raw);
  if (!match) return undefined;
  try {
    parseBasicSource(raw);
  } catch (error) {
    if (error instanceof BasicProgramError) return undefined;
    throw error;
  }
  const number = Number(match[2]);
  const remainder = match[3]!;
  const leadingBodySpaces = /^ */u.exec(remainder)![0].length;
  return {
    physicalLine,
    number,
    numberStart: match[1]!.length,
    numberEnd: match[1]!.length + match[2]!.length,
    body: remainder.slice(leadingBodySpaces),
    bodyStart: match[1]!.length + match[2]!.length + leadingBodySpaces,
  };
}

/** Find literal line targets outside quoted strings, DATA, and REM. */
export function referencesInBody(body: string): Omit<LineReference, 'line'>[] {
  const {lexemes} = tokenizeBasicLineWithSpans(body);
  const references: Omit<LineReference, 'line'>[] = [];
  /** Read a numeric target or a comma-separated ON branch target list. */
  const readTargets = (keyword: string, from: number): void => {
    let cursor = from;
    for (;;) {
      while (body[cursor] === ' ') cursor++;
      const match = /^[0-9]+/u.exec(body.slice(cursor));
      if (!match) return;
      const target = Number(match[0]);
      references.push({target, keyword, startCharacter: cursor, endCharacter: cursor + match[0].length});
      cursor += match[0].length;
      while (body[cursor] === ' ') cursor++;
      if (body[cursor] !== ',') return;
      cursor++;
    }
  };

  for (let index = 0; index < lexemes.length; index++) {
    const lexeme = lexemes[index]!;
    if (lexeme.keyword === 'GOTO' || lexeme.keyword === 'GOSUB' || lexeme.keyword === 'THEN' || lexeme.keyword === 'RUN') {
      readTargets(lexeme.keyword, lexeme.end);
      continue;
    }
    if (lexeme.keyword === 'GO') {
      const next = lexemes.slice(index + 1).find(item => !(item.kind === 'text' && /^ +$/u.test(body.slice(item.start, item.end))));
      if (next?.keyword === 'TO') readTargets('GO TO', next.end);
    }
  }
  return references;
}

/** Resolve effective line definitions, deletions, and their static references. */
export function analyzeProgramLines(text: string): ProgramDocument {
  const definitions = new Map<number, ProgramLine>();
  splitPhysicalLines(text).forEach((raw, index) => {
    const line = parsedPhysicalLine(raw, index + 1);
    if (!line) return;
    if (line.body === '') definitions.delete(line.number);
    else definitions.set(line.number, line);
  });
  const references = [...definitions.values()].flatMap(line => referencesInBody(line.body).map(reference => ({
    ...reference,
    line: line.physicalLine,
    startCharacter: reference.startCharacter + line.bodyStart,
    endCharacter: reference.endCharacter + line.bodyStart,
  })));
  return {definitions, references};
}

/** Find ROM-significant variable names in effective lines only. */
export function variableOccurrences(text: string, document: ProgramDocument = analyzeProgramLines(text)): VariableOccurrence[] {
  const occurrences: VariableOccurrence[] = [];
  for (const line of document.definitions.values()) {
    const {lexemes} = tokenizeBasicLineWithSpans(line.body);
    let runStart = -1, runEnd = -1;
    /** Emit names from the current contiguous tokenizer text run. */
    const emitTextRun = (): void => {
      if (runStart < 0) return;
      const run = line.body.slice(runStart, runEnd);
      for (const match of run.matchAll(/[A-Za-z][A-Za-z0-9]*[$%]?/gu)) {
        const start = runStart + match.index!;
        const name = match[0].toUpperCase();
        occurrences.push({
          name, key: variableKey(name), line: line.physicalLine,
          startCharacter: line.bodyStart + start, endCharacter: line.bodyStart + start + match[0].length,
        });
      }
      runStart = runEnd = -1;
    };
    for (const lexeme of lexemes) {
      if (lexeme.kind !== 'text') {
        emitTextRun();
        continue;
      }
      if (runEnd !== -1 && lexeme.start !== runEnd) emitTextRun();
      if (runStart === -1) runStart = lexeme.start;
      runEnd = lexeme.end;
    }
    emitTextRun();
  }
  return occurrences;
}
