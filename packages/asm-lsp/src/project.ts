/**
 * What the language server needs from a Clementina project: where its
 * manifest is, the include directories and defines a build gives ca65, and
 * the label addresses of the last build.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {parse} from 'yaml';

export interface AsmProject {
  root: string;
  outputDirectory: string;
  /** Include directories in the order a build passes them to ca65 (without the library's). */
  includeDirectories: string[];
  defines: Record<string, string | number>;
  /** The ld65 label file of the last build, `<outputDirectory>/<outputName>.lbl`. */
  labelFile?: string;
  /** `build.assembly.linkerConfig`, as an absolute path. */
  linkerConfig?: string;
  /** True when the project has a BASIC program (`program.entry`), which the assembly returns to. */
  returnsToBasic: boolean;
  /** `build.basic.memoryTop`. */
  memoryTop?: number;
  /** `build.assembly.loadAddress`. */
  loadAddress?: number;
  /** `build.assembly.banks`: the bank of each MEMORY area listed there. */
  banks: Array<{bank: number; memory: string}>;
}

/** A manifest address: a number, or `$7000` / `0x7000` text. */
export function manifestAddress(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (/^(?:\$|0x)[0-9A-Fa-f]+$/u.test(text)) return parseInt(text.replace(/^(?:\$|0x)/u, ''), 16);
  return /^[0-9]+$/u.test(text) ? Number(text) : undefined;
}

/** The folder holding the nearest clementina.yaml at or above a file, or undefined. */
export function findProjectRoot(path: string): string | undefined {
  let directory = dirname(resolve(path));
  for (;;) {
    if (existsSync(join(directory, 'clementina.yaml'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Read the parts of a project's manifest that assembling needs; a missing or broken manifest gives defaults. */
export function readAsmProject(root: string): AsmProject {
  let manifest: {
    program?: {entry?: unknown};
    build?: {outputDirectory?: unknown; basic?: {memoryTop?: unknown}; assembly?: {includeDirectories?: unknown; defines?: unknown; outputName?: unknown; linkerConfig?: unknown; loadAddress?: unknown; banks?: unknown}};
  } = {};
  try {
    const value = parse(readFileSync(join(root, 'clementina.yaml'), 'utf8'));
    if (value && typeof value === 'object') manifest = value;
  } catch {
    // An editor keeps working while the manifest is being edited.
  }
  const build = manifest.build ?? {};
  const outputDirectory = join(root, typeof build.outputDirectory === 'string' ? build.outputDirectory : 'build');
  const assembly = build.assembly ?? {};
  const own = Array.isArray(assembly.includeDirectories) ? assembly.includeDirectories.filter((item): item is string => typeof item === 'string').map(item => join(root, item)) : [];
  const defines: Record<string, string | number> = {};
  if (assembly.defines && typeof assembly.defines === 'object') {
    for (const [name, value] of Object.entries(assembly.defines)) if (typeof value === 'string' || typeof value === 'number') defines[name] = value;
  }
  const memoryTop = manifestAddress(build.basic?.memoryTop);
  const loadAddress = manifestAddress(assembly.loadAddress);
  const banks = Array.isArray(assembly.banks)
    ? assembly.banks.filter((item): item is {bank: number; memory: string} => typeof item?.bank === 'number' && typeof item?.memory === 'string')
      .map(item => ({bank: item.bank, memory: item.memory}))
    : [];
  return {
    root, outputDirectory, defines, banks,
    returnsToBasic: typeof manifest.program?.entry === 'string' && manifest.program.entry !== '',
    ...(memoryTop !== undefined ? {memoryTop} : {}),
    ...(loadAddress !== undefined ? {loadAddress} : {}),
    ...(typeof assembly.linkerConfig === 'string' ? {linkerConfig: join(root, assembly.linkerConfig)} : {}),
    // The same order as the build: the project's own, the machine definitions, the library, the generated assets.
    includeDirectories: [...own, join(outputDirectory, 'include'), join(outputDirectory, 'lib'), outputDirectory],
    ...(typeof assembly.outputName === 'string' ? {labelFile: join(outputDirectory, `${assembly.outputName}.lbl`)} : {}),
  };
}

/** Label addresses from an ld65 `-Ln` file (`al 007000 .add_point`). */
export function readLabels(path: string): Map<string, number> {
  const labels = new Map<string, number>();
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
      const match = /^al\s+([0-9A-Fa-f]+)\s+\.(\S+)$/u.exec(line.trim());
      if (match && !labels.has(match[2]!)) labels.set(match[2]!, parseInt(match[1]!, 16));
    }
  } catch {
    // No build yet.
  }
  return labels;
}
