import {basicKeywordEntries} from './keyword-data.js';
import type {BasicKeywordArgument, BasicKeywordEntry} from './types.js';

export {basicKeywordEntries};

/** Whether a token is used as an expression function or a statement. */
export type BasicSignatureKind = 'function' | 'statement';

/** Display syntax and ordered parameter names for one ROM callable. */
export interface BasicSignature {
  keyword: string;
  kind: BasicSignatureKind;
  label: string;
  parameters: string[];
}

/** Name an argument for the editor: repeating ones end in `...`, optional ones in `?`. */
const parameterName = (argument: BasicKeywordArgument): string =>
  `${argument.name}${argument.repeats ? '...' : ''}${argument.optional ? '?' : ''}`;

/** Keyword entries by uppercase ROM token name. */
export const basicKeywordByName: ReadonlyMap<string, BasicKeywordEntry> = new Map(basicKeywordEntries.map(entry => [entry.keyword, entry]));

/** Editor-facing signatures for ROM statements and functions. Optional arguments use a trailing `?`. */
export const basicSignatures: readonly BasicSignature[] = basicKeywordEntries
  .filter((entry): entry is BasicKeywordEntry & {kind: BasicSignatureKind} => entry.kind === 'statement' || entry.kind === 'function')
  .map(entry => ({keyword: entry.keyword, kind: entry.kind, label: entry.syntax, parameters: entry.arguments.map(parameterName)}));

/** Signature lookup by uppercase ROM token name. */
export const basicSignatureByKeyword = new Map(basicSignatures.map(signature => [signature.keyword, signature]));
/** Statement token names from the signature catalog. */
export const basicStatementKeywords = new Set(basicSignatures.filter(signature => signature.kind === 'statement').map(signature => signature.keyword));
/** Function token names from the signature catalog. */
export const basicFunctionKeywords = new Set(basicSignatures.filter(signature => signature.kind === 'function').map(signature => signature.keyword));
/** Operator token names, symbols and words alike. */
export const basicOperatorKeywords = new Set(basicKeywordEntries.filter(entry => entry.kind === 'operator').map(entry => entry.keyword));
/** Words that only appear inside another statement or expression (`TO`, `THEN`, `STEP`, `AND`...). */
export const basicExpressionKeywords = new Set(basicKeywordEntries
  .filter(entry => entry.kind === 'keyword' || (entry.kind === 'operator' && /^[A-Z]/u.test(entry.keyword)))
  .map(entry => entry.keyword));
