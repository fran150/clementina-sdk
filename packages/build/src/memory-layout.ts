// Where every part of a build lands in CPU memory and MIA RAM. The build
// reports placement and never chooses it: an overlap is a warning, because
// avoiding one (or overwriting BASIC on purpose) is the programmer's call.
import {diagnostic, type ClementinaDiagnostic} from '@clementina/core';
import type {LoadPlan} from '@clementina/basic';
import type {AssetBuildPlan} from './assets.js';

export interface MemoryLayoutRegion {
  name: string;
  /** Who the bytes belong to: the machine, BASIC, the program, or a build output. */
  owner: 'system' | 'kernel' | 'basic' | 'program' | 'asset' | 'video' | 'storage';
  /** CPU only: the bank that the bytes from $8000 up are in (0 for base RAM and bank 0). */
  bank?: number;
  /** A CPU address, or a MIA RAM address. */
  start: number;
  size: number;
  /** The card file loaded there, when the load plan loads one. */
  file?: string;
  note?: string;
}

export interface MemoryLayout {
  format: 'clementina-memory-layout';
  version: 1;
  cpu: MemoryLayoutRegion[];
  mia: MemoryLayoutRegion[];
  /** Overlaps between parts, all warnings. */
  diagnostics: ClementinaDiagnostic[];
}

/** specs/cpu-memory-map.json: image.start, image.kernelRegionEndExclusive, image.heapEndExclusive. */
const IMAGE_START = 0x0400, KERNEL_END = 0x1600, BASIC_TOP = 0xc000;
const WINDOW = 0x8000, BANK_SIZE = 0x4000;
/** SD/FS state, docs/architecture/storage.md. */
const SDFS_START = 0x13000, SDFS_END = 0x13c00;

const hex = (value: number, digits = 4) => `$${value.toString(16).toUpperCase().padStart(digits, '0')}`;

/** A CPU region as ranges of one linear space: base RAM, then the 32 banks one after another. */
function cpuRanges(region: MemoryLayoutRegion): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = region.start, left = region.size;
  if (start < WINDOW) {
    const base = Math.min(left, WINDOW - start);
    ranges.push([start, start + base]);
    left -= base; start = WINDOW;
  }
  if (left > 0) {
    const linear = WINDOW + (region.bank ?? 0) * BANK_SIZE + (start - WINDOW);
    ranges.push([linear, linear + left]);
  }
  return ranges;
}

const miaRanges = (region: MemoryLayoutRegion): Array<[number, number]> => [[region.start, region.start + region.size]];

function describe(region: MemoryLayoutRegion, space: 'cpu' | 'mia'): string {
  if (space === 'mia') return `${region.name} (MIA ${hex(region.start, 5)}-${hex(region.start + region.size - 1, 5)})`;
  const bank = region.bank ? ` bank ${region.bank}` : '';
  return `${region.name} (${hex(region.start)}-${hex(Math.min(region.start + region.size, 0x10000) - 1)}${bank})`;
}

/** Warn about every pair of regions that share bytes, unless both belong to the machine. */
function overlaps(space: 'cpu' | 'mia', regions: MemoryLayoutRegion[], ignore: (a: MemoryLayoutRegion, b: MemoryLayoutRegion) => boolean): ClementinaDiagnostic[] {
  const fixed = new Set(['system', 'kernel', 'basic', 'storage']);
  const ranges = space === 'cpu' ? cpuRanges : miaRanges;
  const diagnostics: ClementinaDiagnostic[] = [];
  regions.forEach((a, i) => regions.slice(0, i).forEach(b => {
    if (fixed.has(a.owner) && fixed.has(b.owner)) return;
    if (ignore(a, b)) return;
    const shared = ranges(a).some(([lo, hi]) => ranges(b).some(([low, high]) => lo < high && low < hi));
    if (shared) diagnostics.push({...diagnostic('build.layout.overlap', `/${space}`, `${describe(a, space)} overlaps ${describe(b, space)}`), severity: 'warning'});
  }));
  return diagnostics;
}

export interface MemoryLayoutInput {
  loadPlan: LoadPlan;
  /** True when a BASIC program runs after the loads, so BASIC's RAM must survive them. */
  returnsToBasic: boolean;
  assets?: AssetBuildPlan;
}

/** Map every part of a build, plus the machine's own areas, and warn about overlaps. */
export function memoryLayout({loadPlan, returnsToBasic, assets}: MemoryLayoutInput): MemoryLayout {
  const memoryTop = loadPlan.steps.find(step => step.kind === 'memoryTop')?.address ?? BASIC_TOP;
  const cpu: MemoryLayoutRegion[] = [
    {name: 'system', owner: 'system', start: 0, size: IMAGE_START, note: 'Zero page, stack, input buffers and kernel variables'},
    {name: 'kernel', owner: 'kernel', start: IMAGE_START, size: KERNEL_END - IMAGE_START, note: 'Jump table, kernel and WozMon; BLOAD and BRUN run from here'},
    {name: 'BASIC', owner: 'basic', bank: 0, start: KERNEL_END, size: memoryTop - KERNEL_END,
      note: `The interpreter, then the program, variables and strings up to MEMSIZ (${hex(memoryTop)}); where the interpreter ends moves with each ROM build`},
  ];
  const mia: MemoryLayoutRegion[] = [
    {name: 'SD/FS state', owner: 'storage', start: SDFS_START, size: SDFS_END - SDFS_START, note: 'File commands rely on it'},
  ];
  for (const step of loadPlan.steps) {
    if (step.kind === 'prg') cpu.push({name: step.path, owner: 'program', bank: step.bank ?? 0, start: step.loadAddress, size: step.length, file: step.path});
    if (step.kind === 'mia') mia.push({name: step.path, owner: 'video', start: step.address, size: step.length, file: step.path});
  }
  for (const slot of assets?.slots ?? []) {
    if (slot.builtin) continue;
    if (slot.space === 'mia') mia.push({name: slot.name, owner: 'asset', start: slot.mia!, size: slot.size});
    else cpu.push({name: slot.name, owner: 'asset', bank: slot.bank!, start: slot.address!, size: slot.size});
  }
  // A program that takes over with BRUN may reuse BASIC's RAM, but not the loader running it.
  const cpuIgnore = (a: MemoryLayoutRegion, b: MemoryLayoutRegion) => !returnsToBasic && (a.owner === 'basic' || b.owner === 'basic');
  return {
    format: 'clementina-memory-layout', version: 1, cpu, mia,
    diagnostics: [...overlaps('cpu', cpu, cpuIgnore), ...overlaps('mia', mia, () => false)],
  };
}
