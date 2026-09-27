import {assertValid, diagnostic, result, schemaDiagnostics, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {assetPaths, type ClementinaProjectManifest, type ProjectAssetSlot, type ProjectAssetsBuild} from './types.js';
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
    paths.push(['/build/outputDirectory', m.build.outputDirectory]);
    if (m.build.assembly && m.build.basic) diagnostics.push(diagnostic('project.build.configuration', '/build', 'Choose either assembly or BASIC build settings'));
    if (m.program.kind === 'mixed') diagnostics.push(diagnostic('project.build.kind', '/program/kind', 'Mixed-project composition is not defined yet'));
    if ('assembly' in m.build && m.build.assembly) {
      paths.push(['/build/assembly/linkerConfig', m.build.assembly.linkerConfig]);
      paths.push(...(m.build.assembly.includeDirectories ?? []).map((p, i): [string, string] => [`/build/assembly/includeDirectories/${i}`, p]));
      if (m.program.kind !== 'assembly') diagnostics.push(diagnostic('project.build.kind', '/build/assembly', 'Assembly build settings require program.kind assembly'));
      const banked = m.build.assembly.loadAddress >= 0x8000;
      if (banked && m.build.assembly.bank === undefined) diagnostics.push(diagnostic('project.build.bank', '/build/assembly/bank', 'A bank is required for an image linked at $8000-$BFFF'));
      if (!banked && m.build.assembly.bank !== undefined) diagnostics.push(diagnostic('project.build.bank', '/build/assembly/bank', 'A bank is only valid for an image linked at $8000-$BFFF'));
    } else if (m.program.kind !== 'basic') diagnostics.push(diagnostic('project.build.kind', '/build/basic', 'BASIC build settings require program.kind basic'));
    if (m.program.kind === 'basic' && (m.program.sources?.length ?? 0) > 0) diagnostics.push(diagnostic('project.basic.sources', '/program/sources', 'BASIC builds currently compile the entry source only'));
    if (m.build.assets) {
      if (m.program.kind !== 'assembly') diagnostics.push(diagnostic('project.build.assets.kind', '/build/assets', 'Asset builds need an assembly program: the runtime library is ca65 code'));
      diagnostics.push(...assetBuildDiagnostics(m.build.assets));
    }
    const ids = new Set<string>(), banks = new Set<number>();
    m.build.video?.tilesets?.forEach((placement, i) => {
      if (ids.has(placement.tilesetId)) diagnostics.push(diagnostic('project.build.tileset', `/build/video/tilesets/${i}/tilesetId`, 'A tileset may be assigned only once'));
      if (banks.has(placement.bank)) diagnostics.push(diagnostic('project.build.chr-bank', `/build/video/tilesets/${i}/bank`, 'A CHR bank may be assigned only once'));
      ids.add(placement.tilesetId); banks.add(placement.bank);
    });
  }
  const seen = new Set<string>();
  for (const kind of assetKinds) assetPaths(m, kind).forEach((p, i) => {
    const pointer = `/assets/${kind}/${i}`;
    paths.push([pointer, p]);
    if (seen.has(p)) diagnostics.push(diagnostic('project.path.duplicate', pointer, 'Asset paths must be unique across all kinds'));
    seen.add(p);
  });
  for (const [pointer, p] of paths) if (!isProjectPath(p)) diagnostics.push(diagnostic('project.path', pointer, 'Expected a project-relative POSIX path without traversal'));
  return result(value, diagnostics);
}
export function validateProjectManifest(value: unknown): void { assertValid(checkProjectManifest(value)); }

/** MIA RAM a user slot may use: everything the firmware leaves free. */
export const MIA_FREE_START = 0x14000, MIA_FREE_END = 0x40000;
/** Slots every build has: the hardware places a file can load straight into. */
export const BUILTIN_SLOTS: readonly Required<Pick<ProjectAssetSlot, 'name' | 'mia' | 'size'>>[] = [
  {name: 'palettes', mia: 0x00100, size: 256},
  ...Array.from({length: 8}, (_, bank) => ({name: `chr${bank}`, mia: 0x00200 + bank * 6144, size: 6144})),
  {name: 'overlay', mia: 0x10080, size: 2000},
];
/** A bank slot's place in the 512 KiB of banked RAM, as if the banks were one run. */
export const bankLinear = (slot: Pick<ProjectAssetSlot, 'bank' | 'address'>): number => slot.bank! * 0x4000 + (slot.address! - 0x8000);

function assetBuildDiagnostics(a: ProjectAssetsBuild): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  const names = new Map(BUILTIN_SLOTS.map(slot => [slot.name.toLowerCase(), slot.name]));
  const symbols = new Set(BUILTIN_SLOTS.map(s => s.name.toUpperCase()));
  const ranges: Array<{name: string; space: 'mia' | 'bank'; start: number; end: number; index: number}> = [];
  a.slots.forEach((slot, i) => {
    const path = `/build/assets/slots/${i}`;
    if (names.has(slot.name.toLowerCase())) diagnostics.push(diagnostic('project.build.slot.name', `${path}/name`, BUILTIN_SLOTS.some(b => b.name === names.get(slot.name.toLowerCase())) ? `${slot.name} is a built-in slot` : 'Slot names must be unique ignoring case'));
    names.set(slot.name.toLowerCase(), slot.name);
    const symbol = slot.name.toUpperCase().replace(/_+$/u, '');
    if (symbols.has(symbol)) diagnostics.push(diagnostic('project.build.slot.symbol', `${path}/name`, 'Slot names must produce distinct assembly constants'));
    symbols.add(symbol);
    const mia = slot.mia !== undefined, bank = slot.bank !== undefined || slot.address !== undefined;
    if (mia === bank || (bank && (slot.bank === undefined || slot.address === undefined))) {
      diagnostics.push(diagnostic('project.build.slot.place', path, 'A slot is either in MIA RAM (mia) or in CPU banks (bank and address)'));
      return;
    }
    if (mia) {
      if (slot.mia! < MIA_FREE_START || slot.mia! + slot.size > MIA_FREE_END) diagnostics.push(diagnostic('project.build.slot.reserved', path, `${slot.name} must lie in MIA's free RAM, $14000-$3FFFF`));
      ranges.push({name: slot.name, space: 'mia', start: slot.mia!, end: slot.mia! + slot.size, index: i});
    } else {
      const start = bankLinear(slot);
      if (start + slot.size > 32 * 0x4000) diagnostics.push(diagnostic('project.build.slot.banks', path, `${slot.name} runs past bank 31`));
      ranges.push({name: slot.name, space: 'bank', start, end: start + slot.size, index: i});
    }
  });
  ranges.forEach((r, i) => ranges.slice(0, i).forEach(q => {
    if (q.space === r.space && r.start < q.end && q.start < r.end) diagnostics.push(diagnostic('project.build.slot.overlap', `/build/assets/slots/${r.index}`, `${r.name} overlaps ${q.name}`));
  }));
  const included = new Set<string>(), files = new Map<string, string>();
  a.include.forEach((entry, i) => {
    const path = `/build/assets/include/${i}`, key = `${entry.kind}\0${entry.id}`;
    if (included.has(key)) diagnostics.push(diagnostic('project.build.include.duplicate', path, `${entry.id} is already included as a ${entry.kind}`));
    included.add(key);
    if (!names.has(entry.slot.toLowerCase()) || names.get(entry.slot.toLowerCase()) !== entry.slot) diagnostics.push(diagnostic('project.build.include.slot', `${path}/slot`, `Unknown slot ${entry.slot}`));
    if (entry.file !== undefined) {
      const other = files.get(entry.file.toUpperCase());
      if (other !== undefined) diagnostics.push(diagnostic('project.build.include.file', `${path}/file`, `${entry.file} is also the file of ${other}`));
      files.set(entry.file.toUpperCase(), entry.id);
    }
  });
  return diagnostics;
}
