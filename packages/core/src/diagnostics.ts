import {Ajv2020} from 'ajv/dist/2020.js';
import {schemas} from './schemas.js';
import type {ClementinaDiagnostic} from './types.js';

export type ValidationResult<T> =
  | {ok: true; value: T; diagnostics: ClementinaDiagnostic[]}
  | {ok: false; diagnostics: ClementinaDiagnostic[]};

export class ValidationError extends Error {
  constructor(public readonly diagnostics: ClementinaDiagnostic[]) {
    super(diagnostics.map(d => `${d.path || '/'}: ${d.message}`).join('\n'));
    this.name = 'ValidationError';
  }
}
export function diagnostic(code: string, path: string, message: string): ClementinaDiagnostic {
  return {severity: 'error', code, path, message};
}
export function result<T>(value: unknown, diagnostics: ClementinaDiagnostic[]): ValidationResult<T> {
  return diagnostics.some(d => d.severity === 'error') ? {ok: false, diagnostics} : {ok: true, value: value as T, diagnostics};
}
export function assertValid<T>(r: ValidationResult<T>): T {
  if (!r.ok) throw new ValidationError(r.diagnostics);
  return r.value;
}
const ajv = new Ajv2020({allErrors: true, strict: true});
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]));
export function schemaDiagnostics(name: keyof typeof schemas, value: unknown): ClementinaDiagnostic[] {
  const validate = validators[name];
  if (validate(value)) return [];
  return (validate.errors ?? []).map(e => diagnostic(`schema.${e.keyword}`, e.instancePath, e.message ?? 'Invalid value'));
}
