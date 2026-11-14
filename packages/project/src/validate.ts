import {assertValid, diagnostic, result, schemaDiagnostics, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {assetPaths, type ClementinaProjectManifest, type ProjectAssetSlot, type ProjectAssetsBuild} from './types.js';
import {assetKinds} from '@clementina/assets';
export const isProjectPath = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && !/[\\\x00-\x1f]/.test(p) && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').some(x => x === '' || x === '.' || x === '..');
export function checkProjectManifest(value: unknown): ValidationResult<ClementinaProjectManifest> {
  const diagnostics = schemaDiagnostics('project', value);
  if (diagnostics.length) return result(value, diagnostics);
  const m = value as ClementinaProjectManifest;
  if (!m.name.trim()) diagnostics.push(diagnostic('project.name', '/name', 'Name must not be blank'));
  if (m.target.phi2Hz !== undefined && m.target.phi2Hz !== 1200000) diagnostics.push(diagnostic('project.target.phi2Hz', '/target/phi2Hz', 'Project builds and launches cannot apply a non-default PHI2 speed yet'));
  if (!m.program && !m.build?.assembly) diagnostics.push(diagnostic('project.program', '', 'A project needs a BASIC program (program.entry), assembly (build.assembly), or both'));
  const paths: [string, string][] = m.program ? [['/program/entry', m.program.entry]] : [];
  if (m.build) {
    paths.push(['/build/outputDirectory', m.build.outputDirectory]);
    if (m.build.assembly) {
      const assembly = m.build.assembly;
      paths.push(...assembly.sources.map((p, i): [string, string] => [`/build/assembly/sources/${i}`, p]));
      if (m.program && assembly.sources.includes(m.program.entry)) diagnostics.push(diagnostic('project.source.duplicate', '/build/assembly/sources', 'The BASIC entry must not also be an assembly source'));
      paths.push(['/build/assembly/linkerConfig', assembly.linkerConfig]);
      paths.push(...(assembly.includeDirectories ?? []).map((p, i): [string, string] => [`/build/assembly/includeDirectories/${i}`, p]));
      const banked = assembly.loadAddress >= 0x8000;
      if (banked && assembly.bank === undefined) diagnostics.push(diagnostic('project.build.bank', '/build/assembly/bank', 'A bank is required for an image linked at $8000-$BFFF'));
      if (!banked && assembly.bank !== undefined) diagnostics.push(diagnostic('project.build.bank', '/build/assembly/bank', 'A bank is only valid for an image linked at $8000-$BFFF'));
    }
    if (m.program && !m.build.basic) diagnostics.push(diagnostic('project.build.basic', '/build', 'A project with a BASIC program (program.entry) needs build.basic settings'));
    if (!m.program && m.build.basic) diagnostics.push(diagnostic('project.build.basic', '/build/basic', 'BASIC build settings need a BASIC program (program.entry)'));
    if (m.build.assets) {
      if (!m.build.assembly) diagnostics.push(diagnostic('project.build.assets.assembly', '/build/assets', 'Asset builds need build.assembly: the runtime library is ca65 code'));
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

/** MIA RAM a user slot may use: the programs block, specs/machine.json miaRam.programs. */
export const MIA_FREE_START = 0x14000, MIA_FREE_END = 0x40000;
/** Slots every build has: the hardware places a file can load straight into. */
export const BUILTIN_SLOTS: readonly Required<Pick<ProjectAssetSlot, 'name' | 'mia' | 'size'>>[] = [
  {name: 'palettes', mia: 0x00100, size: 256},
  ...Array.from({length: 8}, (_, bank) => ({name: `chr${bank}`, mia: 0x00200 + bank * 6144, size: 6144})),
  {name: 'overlay', mia: 0x10080, size: 2000},
];
/** A bank slot's place in the 512 KiB of banked RAM, as if the banks were one run. */
export const bankLinear = (slot: Pick<ProjectAssetSlot, 'bank' | 'address'>): number => slot.bank! * 0x4000 + (slot.address! - 0x8000);

/** A likely mistake that the programmer may intend: placement is theirs to decide. */
function warning(code: string, path: string, message: string): ClementinaDiagnostic {
  return {...diagnostic(code, path, message), severity: 'warning'};
}

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
    if (q.space === r.space && r.start < q.end && q.start < r.end) diagnostics.push(warning('project.build.slot.overlap', `/build/assets/slots/${r.index}`, `${r.name} overlaps ${q.name}`));
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
