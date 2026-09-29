import {diagnostic, type ClementinaDiagnostic} from '@clementina/core';
import type {AssemblyBuildRequest} from './types.js';

/**
 * Check the lexical rules for a project-relative portable path.
 *
 * @param value - Path supplied in a build request.
 * @returns Whether the path avoids absolute forms, traversal, and controls.
 */
function portablePath(value: string): boolean {
  return value.length > 0 && value.length <= 255
    && !value.startsWith('/')
    && !/^[A-Za-z]:/u.test(value)
    && !/[\\\u0000-\u001f\u007f]/u.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

const symbolPattern = /^[A-Za-z_@][A-Za-z0-9_@.$]*$/u;
const definePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const outputPattern = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u;

/**
 * Append a diagnostic when one request path is not portable.
 *
 * @param path - Path to check.
 * @param pointer - JSON Pointer identifying the request field.
 * @param diagnostics - Mutable diagnostics collected for the request.
 */
function validatePath(path: string, pointer: string, diagnostics: ClementinaDiagnostic[]): void {
  if (!portablePath(path)) {
    diagnostics.push(diagnostic('assembler.path', pointer, 'Expected a project-relative portable path'));
  }
}

/**
 * Validate each path in an indexed request field.
 *
 * @param paths - Source, include-directory, or library paths.
 * @param field - Name of the containing request field.
 * @param diagnostics - Mutable diagnostics collected for the request.
 */
function validatePaths(paths: readonly string[], field: string, diagnostics: ClementinaDiagnostic[]): void {
  for (const [index, path] of paths.entries()) {
    validatePath(path, `/${field}/${index}`, diagnostics);
  }
}

/**
 * Check request names, paths, load placement, bank selection, and defines.
 *
 * @param request - Assembly build request to inspect before any tool runs.
 * @returns All request diagnostics in validation order.
 */
export function validateRequest(request: AssemblyBuildRequest): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  if (!Array.isArray(request.sources) || request.sources.length === 0) {
    diagnostics.push(diagnostic('assembler.sources', '/sources', 'At least one assembly source is required'));
  }
  validatePaths(request.sources ?? [], 'sources', diagnostics);
  validatePaths(request.includeDirectories ?? [], 'includeDirectories', diagnostics);
  validatePaths(request.libraries ?? [], 'libraries', diagnostics);
  validatePath(request.linkerConfig, '/linkerConfig', diagnostics);
  validatePath(request.outputDirectory, '/outputDirectory', diagnostics);
  if (!outputPattern.test(request.outputName)) {
    diagnostics.push(diagnostic('assembler.output-name', '/outputName', 'Expected a portable filename stem beginning with a letter'));
  }
  if (!Number.isInteger(request.loadAddress) || request.loadAddress < 1 || request.loadAddress > 0xbfff) {
    diagnostics.push(diagnostic('assembler.load-address', '/loadAddress', 'Expected a CPU load address from $0001 through $BFFF'));
  }
  if (!symbolPattern.test(request.entrySymbol)) {
    diagnostics.push(diagnostic('assembler.entry-symbol', '/entrySymbol', 'Expected a ca65 symbol name'));
  }
  if (request.bank !== undefined && (!Number.isInteger(request.bank) || request.bank < 1 || request.bank > 31)) {
    diagnostics.push(diagnostic('assembler.bank', '/bank', 'Expected a bank from 1 through 31'));
  }
  if (request.loadAddress >= 0x8000 && request.bank === undefined) {
    diagnostics.push(diagnostic('assembler.bank', '/bank', 'A bank is required for images linked at $8000-$BFFF'));
  }
  if (request.loadAddress < 0x8000 && request.bank !== undefined) {
    diagnostics.push(diagnostic('assembler.bank', '/bank', 'A bank is only valid for images linked at $8000-$BFFF'));
  }
  for (const key of Object.keys(request.defines ?? {})) {
    if (!definePattern.test(key)) {
      diagnostics.push(diagnostic('assembler.define', `/defines/${key}`, 'Expected a ca65 identifier'));
    }
  }
  return diagnostics;
}
