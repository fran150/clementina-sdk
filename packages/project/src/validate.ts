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
  if (m.program.sources?.includes(m.program.entry)) diagnostics.push(diagnostic('project.source.duplicate', '/program/sources', 'The entry source must not also appear in program.sources'));
  if (m.build) {
    paths.push(['/build/outputDirectory', m.build.outputDirectory], ['/build/assembly/linkerConfig', m.build.assembly.linkerConfig]);
    paths.push(...(m.build.assembly.includeDirectories ?? []).map((p, i): [string, string] => [`/build/assembly/includeDirectories/${i}`, p]));
    if (m.program.kind !== 'assembly') diagnostics.push(diagnostic('project.build.kind', '/build/assembly', 'The current build composer supports assembly projects only'));
    const banked = m.build.assembly.loadAddress >= 0x8000;
    if (banked && m.build.assembly.bank === undefined) diagnostics.push(diagnostic('project.build.bank', '/build/assembly/bank', 'A bank is required for an image linked at $8000-$BFFF'));
    if (!banked && m.build.assembly.bank !== undefined) diagnostics.push(diagnostic('project.build.bank', '/build/assembly/bank', 'A bank is only valid for an image linked at $8000-$BFFF'));
    const ids = new Set<string>(), banks = new Set<number>();
    m.build.video?.tilesets?.forEach((placement, i) => {
      if (ids.has(placement.tilesetId)) diagnostics.push(diagnostic('project.build.tileset', `/build/video/tilesets/${i}/tilesetId`, 'A tileset may be assigned only once'));
      if (banks.has(placement.bank)) diagnostics.push(diagnostic('project.build.chr-bank', `/build/video/tilesets/${i}/bank`, 'A CHR bank may be assigned only once'));
      ids.add(placement.tilesetId); banks.add(placement.bank);
    });
  }
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
