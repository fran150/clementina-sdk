import {assertValid, diagnostic, result, schemaDiagnostics, type ValidationResult} from '@clementina/core';
import type {ClementinaProjectManifest} from './types.js';
import {assetKinds} from '@clementina/assets';
export const isProjectPath = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && !/[\\\x00-\x1f]/.test(p) && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').some(x => x === '' || x === '.' || x === '..');
export function checkProjectManifest(value: unknown): ValidationResult<ClementinaProjectManifest> {
  const diagnostics = schemaDiagnostics('project', value);
  if (diagnostics.length) return result(value, diagnostics);
  const m = value as ClementinaProjectManifest;
  if (!m.name.trim()) diagnostics.push(diagnostic('project.name', '/name', 'Name must not be blank'));
  const paths: [string, string][] = [['/program/entry', m.program.entry], ...(m.program.sources ?? []).map((p, i): [string, string] => [`/program/sources/${i}`, p])];
  const seen = new Set<string>();
  for (const kind of assetKinds) m.assets[kind].forEach((p, i) => {
    const pointer = `/assets/${kind}/${i}`;
    paths.push([pointer, p]);
    if (seen.has(p)) diagnostics.push(diagnostic('project.path.duplicate', pointer, 'Asset paths must be unique across all kinds'));
    seen.add(p);
  });
  for (const [pointer, p] of paths) if (!isProjectPath(p)) diagnostics.push(diagnostic('project.path', pointer, 'Expected a project-relative POSIX path without traversal'));
  return result(value, diagnostics);
}
export function validateProjectManifest(value: unknown): void { assertValid(checkProjectManifest(value)); }
