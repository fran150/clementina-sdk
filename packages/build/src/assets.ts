// The asset build: the files the game loads from the card, the descriptors
// and constants the game assembles with, and the memory report. Pure: the
// caller writes the files. docs/gamedev/builder.md describes every format.
import {diagnostic, result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {BUILTIN_SLOTS, type PortableProject, type ProjectAssetBuildKind, type ProjectAssetInclude, type ProjectAssetSlot} from '@clementina/project';
import {bankLocation} from '@clementina/runtime';
import {encodeIncludedAsset} from './asset-encoding.js';
import {identifier} from './asset-names.js';
import {renderAssetsInc, renderAssetsS} from './asset-render.js';

export {renderAssetsInc, renderAssetsS} from './asset-render.js';
export {identifier} from './asset-names.js';

export interface PlannedSlot {
  name: string;
  builtin: boolean;
  space: 'mia' | 'bank';
  /** The runtime location of its first byte. */
  location: number;
  size: number;
  mia?: number;
  bank?: number;
  address?: number;
}

export interface PlannedItem {kind: 'shape' | 'animation'; id: string; name: string; label: string; number: number; offset: number; size: number}
export interface PlannedPlaceholder {id: string; name: string; label: string; number: number; col: number; row: number; width: number; height: number}

export interface PlannedAsset {
  kind: ProjectAssetBuildKind;
  id: string;
  name: string;
  /** The descriptor's label in assets.s. */
  label: string;
  /** Filename on the card, inside the asset folder. */
  file: string;
  /** Path relative to the game's folder on the card. */
  path: string;
  slot: string;
  bytes: Uint8Array;
  /** Sprite files: shapes, then animations. */
  items?: PlannedItem[];
  placeholders?: PlannedPlaceholder[];
  width?: number;
  height?: number;
  voiceOffsets?: Array<number | null>;
  entries?: number;
  bpp?: 1 | 3;
}

export interface MemoryReport {
  format: 'clementina-memory-report';
  version: 1;
  folder: string;
  slots: Array<Omit<PlannedSlot, 'location'> & {location: number; used: number; assets: Array<{kind: ProjectAssetBuildKind; id: string; name: string; label: string; file: string; size: number}>}>;
  diagnostics: ClementinaDiagnostic[];
  /** Assembled CODE bytes per runtime module, populated by buildProject. */
  runtimeCode?: Record<string, number>;
}

export interface AssetBuildPlan {
  folder: string;
  checks: boolean;
  slots: PlannedSlot[];
  assets: PlannedAsset[];
  assetsInc: string;
  assetsS: string;
  report: MemoryReport;
}

const PREFIX: Record<ProjectAssetBuildKind, string> = {paletteConfig: 'PAL', tileset: 'CHR', background: 'BG', overlay: 'OVL', sprites: 'SPR', song: 'SONG', sound: 'SFX'};
const EXTENSION: Record<ProjectAssetBuildKind, string> = {paletteConfig: 'PAL', tileset: 'CHR', background: 'BG', overlay: 'OVL', sprites: 'SPR', song: 'SNG', sound: 'SFX'};
/** The kind each built-in slot is for. */
const BUILTIN_KIND: Record<string, ProjectAssetBuildKind> = {palettes: 'paletteConfig', overlay: 'overlay', ...Object.fromEntries(Array.from({length: 8}, (_, i) => [`chr${i}`, 'tileset']))};

/** Turn validated custom slots and built-in video slots into runtime locations. */
function planSlots(customSlots: ProjectAssetSlot[]): PlannedSlot[] {
  return [
    ...BUILTIN_SLOTS.map(slot => ({name: slot.name, builtin: true, space: 'mia' as const, location: slot.mia, size: slot.size, mia: slot.mia})),
    ...customSlots.map(slot => slot.mia !== undefined
      ? {name: slot.name, builtin: false, space: 'mia' as const, location: slot.mia, size: slot.size, mia: slot.mia}
      : {name: slot.name, builtin: false, space: 'bank' as const, location: bankLocation(slot.bank!, slot.address!), size: slot.size, bank: slot.bank, address: slot.address}),
  ];
}

/** Reserve a unique assembly label while preserving include order. */
function nextLabel(labels: Set<string>, base: string): string {
  let label = base;
  for (let number = 2; labels.has(label); number++) label = `${base}_${number}`;
  labels.add(label);
  return label;
}

/** Use an explicit filename or allocate a case-insensitively unique 8.3 name. */
function nextFileName(files: Set<string>, entry: ProjectAssetInclude, name: string): string {
  if (entry.file) return entry.file;
  const stem = identifier(name).slice(0, 8);
  const extension = EXTENSION[entry.kind];
  let file = `${stem}.${extension}`;
  for (let number = 1; files.has(file.toUpperCase()); number++) {
    const suffix = String(number).padStart(2, '0');
    file = `${stem.slice(0, 8 - suffix.length)}${suffix}.${extension}`;
  }
  files.add(file.toUpperCase());
  return file;
}

/** Make a warning diagnostic without changing the shared diagnostic helper. */
function warning(code: string, path: string, message: string): ClementinaDiagnostic {
  return {...diagnostic(code, path, message), severity: 'warning'};
}

/** Report capacity and hardware-placement concerns for one encoded asset. */
function slotDiagnostics(asset: PlannedAsset, slot: PlannedSlot, path: string): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  if (asset.bytes.length > slot.size) {
    const message = `${asset.name} (${asset.bytes.length} bytes) is larger than slot ${slot.name} (${slot.size} bytes)`;
    if (asset.kind === 'background') diagnostics.push(warning('build.assets.slot.partial', `${path}/slot`, `${message}: only LoadRows, LoadColumns and LoadRect can use the slot`));
    else diagnostics.push(diagnostic('build.assets.slot.size', `${path}/slot`, message));
  }
  if (asset.kind === 'song' && slot.space === 'bank') diagnostics.push(warning('build.assets.song.bank', `${path}/slot`, `${asset.name} is in a bank: the sequencer reads MIA RAM, so copy it there (Relocate) before PlaySong`));
  if (slot.builtin && BUILTIN_KIND[slot.name] !== asset.kind) diagnostics.push(warning('build.assets.slot.builtin', `${path}/slot`, `${asset.name} loads into ${slot.name}, which holds ${BUILTIN_KIND[slot.name] === 'tileset' ? 'a CHR bank' : slot.name === 'palettes' ? 'the palettes' : 'the overlay'} on screen`));
  return diagnostics;
}

/** Summarize each slot's largest alternative asset and all files assigned to it. */
function memoryReport(folder: string, slots: PlannedSlot[], assets: PlannedAsset[], diagnostics: ClementinaDiagnostic[]): MemoryReport {
  return {
    format: 'clementina-memory-report', version: 1, folder,
    slots: slots.map(slot => {
      const inSlot = assets.filter(asset => asset.slot === slot.name);
      return {...slot, used: Math.max(0, ...inSlot.map(asset => asset.bytes.length)),
        assets: inSlot.map(asset => ({kind: asset.kind, id: asset.id, name: asset.name, label: asset.label, file: asset.file, size: asset.bytes.length}))};
    }),
    diagnostics,
  };
}

/**
 * Plan encoded asset files, ca65 declarations, and a memory report.
 *
 * @param project - A project already checked by `checkProject` or `loadProject`.
 * @returns The plan and any placement warnings, or diagnostics for build errors.
 */
export function planAssetBuild(project: PortableProject): ValidationResult<AssetBuildPlan> {
  const config = project.manifest.build?.assets;
  if (!config) return result(undefined, [diagnostic('build.assets', '/build/assets', 'The project has no asset build')]);
  const diagnostics: ClementinaDiagnostic[] = [];
  const folder = config.folder ?? 'ASSETS';

  const slots = planSlots(config.slots);
  const slotByName = new Map(slots.map(s => [s.name, s]));

  const labels = new Set<string>(), files = new Set<string>();
  // Files named by the build fill in around those the manifest names.
  for (const entry of config.include) if (entry.file) files.add(entry.file.toUpperCase());

  const planned: PlannedAsset[] = [];
  config.include.forEach((entry, index) => {
    const path = `/build/assets/include/${index}`;
    const slot = slotByName.get(entry.slot)!;
    const encoded = encodeIncludedAsset(project, entry, path);
    diagnostics.push(...encoded.diagnostics);
    if (!encoded.ok) return;
    const asset: PlannedAsset = {...encoded.value, slot: entry.slot, label: '', file: '', path: ''};
    asset.label = nextLabel(labels, `${PREFIX[entry.kind]}_${identifier(asset.name)}`);
    asset.file = nextFileName(files, entry, asset.name);
    asset.path = `${folder}/${asset.file}`;
    asset.placeholders?.forEach(placeholder => { placeholder.label = nextLabel(labels, `${asset.label}_${identifier(placeholder.name)}`); });
    asset.items?.forEach(item => { item.label = nextLabel(labels, item.label); });

    diagnostics.push(...slotDiagnostics(asset, slot, path));
    planned.push(asset);
  });

  const report = memoryReport(folder, slots, planned, diagnostics);
  const plan: AssetBuildPlan = {folder, checks: config.checks ?? true, slots, assets: planned, assetsInc: '', assetsS: '', report};
  plan.assetsInc = renderAssetsInc(plan);
  plan.assetsS = renderAssetsS(plan);
  return result(plan, diagnostics);
}
