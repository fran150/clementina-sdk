import {Ajv2020} from 'ajv/dist/2020.js';
import type {ValidateFunction} from 'ajv';
import {diagnostic} from './diagnostics.js';
import {schemas} from './schemas.js';
import type {ClementinaDiagnostic} from './types.js';

const ajv = new Ajv2020({allErrors: true, strict: true});
const validators = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]),
) as Record<keyof typeof schemas, ValidateFunction>;

/**
 * Checks a value against one of the bundled portable JSON Schemas.
 * This checks schema structure only; package-specific semantic rules are separate.
 * @param name - Schema key, such as `palette` or `load-plan`.
 * @param value - Untrusted value to check without modifying it.
 * @returns Error diagnostics, or an empty array when the value matches the schema.
 */
export function schemaDiagnostics(name: keyof typeof schemas, value: unknown): ClementinaDiagnostic[] {
  const validate = validators[name];
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error =>
    diagnostic(`schema.${error.keyword}`, error.instancePath, error.message ?? 'Invalid value'));
}
