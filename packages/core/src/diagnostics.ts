import type {ClementinaDiagnostic} from './types.js';

/** A checked value and its diagnostics, or diagnostics that prevent its use. */
export type ValidationResult<T> =
  | {ok: true; value: T; diagnostics: ClementinaDiagnostic[]}
  | {ok: false; diagnostics: ClementinaDiagnostic[]};

/** An exception carrying the diagnostics from a failed validation result. */
export class ValidationError extends Error {
  /**
   * Formats diagnostic messages for the exception while retaining the full entries.
   * @param diagnostics - Diagnostic entries to expose to callers.
   */
  constructor(public readonly diagnostics: ClementinaDiagnostic[]) {
    super(diagnostics.map(entry => `${entry.path || '/'}: ${entry.message}`).join('\n'));
    this.name = 'ValidationError';
  }
}

/**
 * Creates an error diagnostic at a JSON Pointer in the source document.
 * @param code - Stable machine-readable diagnostic code.
 * @param path - JSON Pointer, or an empty string for the document root.
 * @param message - Human-readable explanation.
 * @returns The diagnostic entry.
 */
export function diagnostic(code: string, path: string, message: string): ClementinaDiagnostic {
  return {severity: 'error', code, path, message};
}

/**
 * Wraps a checked value unless at least one diagnostic has error severity.
 * @typeParam T - Type established by the caller's validation.
 * @param value - Value that passed the caller's checks when no errors exist.
 * @param diagnostics - Diagnostic entries to retain in the result.
 * @returns A success with the value, or a failure with diagnostics only.
 */
export function result<T>(value: unknown, diagnostics: ClementinaDiagnostic[]): ValidationResult<T> {
  return diagnostics.some(entry => entry.severity === 'error') ? {ok: false, diagnostics} : {ok: true, value: value as T, diagnostics};
}

/**
 * Extracts a successful value or throws its diagnostics as a ValidationError.
 * @param validation - Result to inspect.
 * @returns The checked value.
 * @throws {ValidationError} When the result is a failure.
 */
export function assertValid<T>(validation: ValidationResult<T>): T {
  if (!validation.ok) throw new ValidationError(validation.diagnostics);
  return validation.value;
}
