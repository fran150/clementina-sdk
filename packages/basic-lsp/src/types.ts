/** ROM tokenizer table containing a keyword. */
export type BasicKeywordCategory = 'primary' | 'extension' | 'extension2' | 'extensionFunction' | 'special';

/** A source diagnostic using one-based physical line numbers; an error unless `severity` says otherwise. */
export interface BasicLspDiagnostic {
  /** 1-based physical source line, matching BasicProgramError.sourceLine. */
  line: number;
  message: string;
  code: 'basic.parse' | 'basic.compile' | 'basic.target' | 'basic.syntax' | 'basic.glyph';
  severity?: 'warning';
  /** Zero-based source columns when the diagnostic covers a specific token. */
  startCharacter?: number;
  endCharacter?: number;
}

/** ROM token details for a keyword under the cursor. */
export interface BasicHoverInfo {
  keyword: string;
  category: BasicKeywordCategory;
  /** Hex byte(s), e.g. "$89" for a primary token or "$FF,$A0" for a prefixed one. */
  token: string;
}

/** A keyword or document variable offered by completion. */
export interface BasicCompletionItem {
  keyword: string;
  category: BasicKeywordCategory | 'variable';
}

/** Location of the effective numbered-line definition for a target. */
export interface BasicDefinition {
  /** 1-based physical source line containing the effective target definition. */
  line: number;
  startCharacter: number;
  endCharacter: number;
}

/** Signature label, parameters, and zero-based active parameter index. */
export interface BasicSignatureHelp {
  label: string;
  parameters: string[];
  activeParameter: number;
}

/** New first line number and increment for renumbering. */
export interface RenumberBasicOptions {
  start?: number;
  step?: number;
}

/** One-based physical line and zero-based, end-exclusive columns. */
export interface BasicSourceLocation {
  line: number;
  startCharacter: number;
  endCharacter: number;
}

/** Effective line or first occurrence of a ROM-significant variable. */
export interface BasicDocumentSymbol extends BasicSourceLocation {
  name: string;
  kind: 'line' | 'variable';
}

/** Replacement text for a source location. */
export interface BasicTextEdit extends BasicSourceLocation {
  newText: string;
}

/** Semantic token span in physical source coordinates. */
export interface BasicSemanticSpan extends BasicSourceLocation {
  type: 'keyword' | 'number' | 'string' | 'comment' | 'variable' | 'operator';
}

/** How a ROM keyword is used: a statement, a function, an operator, or a word inside another statement. */
export type BasicKeywordKind = 'statement' | 'function' | 'operator' | 'keyword';

/** What an argument accepts; specs/basic.json describes each type under `keywords.argumentTypes`. */
export type BasicArgumentType =
  | 'number' | 'string' | 'expression' | 'path' | 'handle' | 'line-number' | 'condition'
  | 'variable' | 'numeric-variable' | 'array' | 'name' | 'statement' | 'text' | 'keyword';

/** One argument of a ROM keyword, with the range the ROM accepts when it checks one. */
export interface BasicKeywordArgument {
  name: string;
  type: BasicArgumentType;
  optional?: boolean;
  repeats?: boolean;
  /** Smallest value the ROM accepts; smaller values raise an error. */
  min?: number;
  /** Largest value the ROM accepts; larger values raise an error. */
  max?: number;
  note?: string;
}

/** Value a ROM function or operator produces. */
export interface BasicKeywordResult {
  /** `expression` when the result takes the operands' type, as with `+`. */
  type: 'number' | 'string' | 'expression';
  min?: number;
  max?: number;
  note?: string;
}

/** Syntax, arguments, and a one-line summary for one ROM keyword, from specs/basic.json. */
export interface BasicKeywordEntry {
  keyword: string;
  kind: BasicKeywordKind;
  syntax: string;
  arguments: readonly BasicKeywordArgument[];
  returns?: BasicKeywordResult;
  summary: string;
}

/** A `{…}` tag at its physical source location. */
export interface BasicTagSpan extends BasicSourceLocation {
  kind: 'style' | 'character';
  /** The byte a character tag stores. */
  code?: number;
  /** The attribute a style tag selects. */
  attribute?: number;
}

/** One stored character of a quoted string, written directly or as a character tag. */
export interface BasicStringCell extends BasicSourceLocation {
  code: number;
  /** The overlay attribute it prints with, without the raw-tile bit; absent in an unstyled string, which prints at the BASIC pen. */
  attribute?: number;
  tagged: boolean;
}

/** A quoted string's content, between its quotes, and the characters it stores. */
export interface BasicStringSpan extends BasicSourceLocation {
  /** True when the string has a style record: a style tag and at least one character. */
  styled: boolean;
  /** True for a quoted DATA item, which READ copies instead of PRINT printing it from the program. */
  data: boolean;
  cells: BasicStringCell[];
  tags: BasicTagSpan[];
}

/** Quoted strings and every tag, including those in DATA and REM. */
export interface BasicStringAnalysis {
  strings: BasicStringSpan[];
  tags: BasicTagSpan[];
}

/** Hover facts for a tag or a quoted string at a source position. */
export type BasicStringHover =
  | {kind: 'character'; code: number; location: BasicSourceLocation; string?: BasicStringSpan}
  | {kind: 'style'; attribute: number; location: BasicSourceLocation; styled: BasicStringCell[]}
  | {kind: 'string'; string: BasicStringSpan};

/** A tag word offered while a tag is being typed; `newText` replaces the columns from `startCharacter` to `endCharacter`. */
export interface BasicTagCompletion {
  label: string;
  kind: 'color' | 'flag' | 'character';
  detail: string;
  newText: string;
  startCharacter: number;
  endCharacter: number;
  code?: number;
  attribute?: number;
}

/** A one-based line and zero-based column. */
export interface BasicSourcePosition {line: number; character: number}

/** An end-exclusive source range, possibly spanning physical lines. */
export interface BasicSourceRange {start: BasicSourcePosition; end: BasicSourcePosition}

/** One overlay cell of a screen preview; `placeholder` numbers the run-time value whose source text it shows. */
export interface BasicScreenCell {code: number; attribute: number; placeholder?: number}

/** Something a screen preview could not run, on a one-based physical line with BASIC line number `number`. */
export interface BasicScreenNote {line: number; number: number; message: string}

/** A run of cells on one row that show a run-time value's source text instead of the value. */
export interface BasicScreenPlaceholder {row: number; startColumn: number; endColumn: number}

/** The overlay text screen after running some lines' output statements from a cleared screen. */
export interface BasicScreenPreview {
  /** BASIC line numbers of the lines that ran, in source order. */
  lines: number[];
  /** Screen rows from the top through the last one drawn on; empty when nothing is left drawn. */
  rows: BasicScreenCell[][];
  /** Palette bank whose ink BCOLOR made the backdrop; absent for the startup backdrop. */
  backdrop?: number;
  placeholders: BasicScreenPlaceholder[];
  notes: BasicScreenNote[];
}
