import {basicSourceLimits, compileBasicProgram, detokenizeBasicProgram, parseBasicSource} from '@clementina/basic';
import {referencesInBody} from './source.js';
import type {RenumberBasicOptions} from './types.js';

/** Format effective lines in ROM LIST order while retaining valid input shorthand. */
export function formatBasicSource(text: string): string {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const canonical = detokenizeBasicProgram(compileBasicProgram(text));
  if (!canonical) return canonical;
  const original = parseBasicSource(text);
  const listed = canonical.slice(0, -1).split('\n');
  return listed.map((line, index) => {
    if (line.length <= basicSourceLimits.maxInputCharacters) return line;
    const source = original[index]!;
    const readable = `${source.number} ${source.text}`;
    return readable.length <= basicSourceLimits.maxInputCharacters ? readable : `${source.number}${source.text}`;
  }).join('\n') + '\n';
}

/** Renumber effective lines and static GOTO, GOSUB, THEN, GO TO, and RUN targets. */
export function renumberBasicSource(text: string, options: RenumberBasicOptions = {}): string {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const start = options.start ?? 10, step = options.step ?? 10;
  if (!Number.isInteger(start) || start < 0) throw new RangeError('start must be a non-negative integer');
  if (!Number.isInteger(step) || step < 1) throw new RangeError('step must be a positive integer');
  const lines = parseBasicSource(text);
  const last = lines.length === 0 ? start : start + (lines.length - 1) * step;
  if (last > basicSourceLimits.maxLineNumber) throw new RangeError(`renumbered line number exceeds ${basicSourceLimits.maxLineNumber}`);
  const mapping = new Map(lines.map((line, index) => [line.number, start + index * step]));
  const output = lines.map(line => {
    let body = line.text;
    const replacements = referencesInBody(body)
      .filter(reference => mapping.has(reference.target))
      .sort((a, b) => b.startCharacter - a.startCharacter);
    for (const reference of replacements) {
      body = body.slice(0, reference.startCharacter) + mapping.get(reference.target)! + body.slice(reference.endCharacter);
    }
    return `${mapping.get(line.number)!} ${body}`;
  }).join('\n') + (lines.length ? '\n' : '');
  compileBasicProgram(output);
  return output;
}
