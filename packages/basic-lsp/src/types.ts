/** ROM tokenizer table containing a keyword. */
export type BasicKeywordCategory = 'primary' | 'extension' | 'extension2' | 'extensionFunction' | 'special';

/** A source diagnostic using one-based physical line numbers. */
export interface BasicLspDiagnostic {
  /** 1-based physical source line, matching BasicProgramError.sourceLine. */
  line: number;
  message: string;
  code: 'basic.parse' | 'basic.compile' | 'basic.target' | 'basic.syntax';
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
