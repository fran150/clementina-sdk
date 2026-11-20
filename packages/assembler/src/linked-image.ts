import {readFile} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {diagnostic, formatHex, result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {projectRelativePath, type BuildPaths} from './build-paths.js';
import {parseCa65Debug} from './debug.js';
import type {LinkerMemoryArea} from './linker-memory.js';
import type {AssemblyBankRequest, AssemblyBuildRequest, Ca65DebugInfo, DebugSegment} from './types.js';

export interface LinkedImage {
  binary: Uint8Array;
  debug: Ca65DebugInfo;
  /** The bytes of each bank's output file, by absolute path. */
  bankFiles: Map<string, Uint8Array>;
}

type EmittedSegment = DebugSegment & {outputName: string; outputOffset: number};

/** Where one entry of build.assembly.banks is written, from the linker configuration. */
export interface BankOutput {
  request: AssemblyBankRequest;
  /** Index in request.banks, for diagnostic paths. */
  index: number;
  /** Absolute path of the area's output file. */
  file: string;
}

/** A checked bank image: its output file, segments and load address. */
export interface VerifiedBank extends BankOutput {
  loadAddress: number;
  segments: string[];
}

export interface VerifiedImage {
  entryAddress: number;
  /** Banks with code, in request order. */
  banks: VerifiedBank[];
  segmentBanks: Record<string, number>;
}

/** Copy a file's bytes into a plain Uint8Array view. */
function bytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/**
 * Identify a nonempty segment with an output file and binary offset.
 *
 * @param segment - Segment from ld65 debug data.
 * @returns Whether the segment was emitted into a linked file.
 */
function isEmittedSegment(segment: DebugSegment): segment is EmittedSegment {
  return segment.size > 0 && segment.outputName !== undefined && segment.outputOffset !== undefined;
}

/** A warning: the build goes on. */
function warning(code: string, path: string, message: string): ClementinaDiagnostic {
  return {...diagnostic(code, path, message), severity: 'warning'};
}

/**
 * Find each bank's output file in the linker configuration's MEMORY areas.
 * A bank's area needs a file of its own, so its bytes become their own PRG.
 *
 * @param paths - Resolved build paths, for the main output and the project root.
 * @param request - The build request with its banks.
 * @param memory - MEMORY areas read from the linker configuration.
 * @returns The output file of each bank, with warnings, or diagnostics.
 */
export function bankOutputs(
  paths: BuildPaths,
  request: AssemblyBuildRequest,
  memory: ReadonlyMap<string, LinkerMemoryArea>,
): ValidationResult<BankOutput[]> {
  const diagnostics: ClementinaDiagnostic[] = [];
  const outputs: BankOutput[] = [];
  const seen = new Map<string, string>();
  for (const [index, bank] of (request.banks ?? []).entries()) {
    const pointer = `/banks/${index}/memory`;
    const area = memory.get(bank.memory);
    if (!area) {
      diagnostics.push(diagnostic('assembler.bank.memory', pointer, `${request.linkerConfig} has no MEMORY area named ${bank.memory}`));
      continue;
    }
    if (area.file === '') {
      diagnostics.push(diagnostic('assembler.bank.file', pointer, `MEMORY area ${bank.memory} has file = "", so ld65 writes none of its bytes`));
      continue;
    }
    // ld65 writes an area without a file attribute to the main output.
    const file = resolve(paths.root, area.file ?? paths.output.binary);
    if (file === paths.output.binary) {
      diagnostics.push(diagnostic('assembler.bank.file', pointer,
        `MEMORY area ${bank.memory} is written to the main output; give it a file of its own, such as file = "%O.bank${bank.bank}"`));
      continue;
    }
    const other = seen.get(file);
    if (other) {
      diagnostics.push(diagnostic('assembler.bank.file', pointer, `MEMORY areas ${other} and ${bank.memory} are written to the same file`));
      continue;
    }
    seen.set(file, bank.memory);
    if (area.bank === undefined) {
      diagnostics.push(warning('assembler.bank.attribute', pointer,
        `MEMORY area ${bank.memory} has no bank attribute, so ca65's .bank() cannot name its bank; add bank = ${bank.bank}`));
    } else if (area.bank !== bank.bank) {
      diagnostics.push(diagnostic('assembler.bank.attribute', `/banks/${index}/bank`,
        `MEMORY area ${bank.memory} has bank = ${area.bank}, but build.assembly.banks loads it into bank ${bank.bank}`));
    }
    outputs.push({request: bank, index, file});
  }
  return result(outputs, diagnostics);
}

/**
 * Read the linked binary and debug records, normalizing project-local source paths.
 *
 * @param paths - Resolved paths for the binary and ld65 debug file.
 * @param banks - Bank output files to read too; one ld65 left out reads as empty.
 * @returns The binary bytes and parsed debug records.
 * @throws If a build file cannot be read or the debug format is unsupported.
 */
export async function readLinkedImage(paths: BuildPaths, banks: readonly BankOutput[] = []): Promise<LinkedImage> {
  const [binaryBuffer, debugText] = await Promise.all([
    readFile(paths.output.binary),
    readFile(paths.output.debug, 'utf8'),
  ]);
  const bankFiles = new Map<string, Uint8Array>();
  for (const bank of banks) {
    // ld65 does not write a file for an area that got no bytes.
    bankFiles.set(bank.file, await readFile(bank.file).then(bytes, () => new Uint8Array()));
  }
  const binary = bytes(binaryBuffer);
  const debug = parseCa65Debug(debugText);
  debug.files = debug.files.map(file => {
    if (!isAbsolute(file.path)) return file;
    const path = projectRelativePath(paths.root, file.path);
    return path === '..' || path.startsWith('../') ? file : {...file, path};
  });
  return {binary, debug, bankFiles};
}

/**
 * Check one main-image segment against the requested contiguous binary image.
 *
 * @param segment - Segment with an output file and offset.
 * @param loadAddress - CPU address requested for the first binary byte.
 * @param binaryLength - Number of linked binary bytes.
 * @returns Placement and bounds diagnostics for this segment.
 */
function segmentDiagnostics(segment: EmittedSegment, loadAddress: number, binaryLength: number): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  const expected = loadAddress + segment.outputOffset;
  if (segment.start !== expected) {
    diagnostics.push(diagnostic('assembler.image.placement', '',
      `Segment ${segment.name} starts at ${formatHex(segment.start)}, but binary offset ${formatHex(segment.outputOffset)} requires ${formatHex(expected)}`));
  }
  if (segment.outputOffset + segment.size > binaryLength) {
    diagnostics.push(diagnostic('assembler.image.bounds', '',
      `Segment ${segment.name} extends beyond the linked binary`));
  }
  return diagnostics;
}

/**
 * Check one bank's segments: one contiguous image inside $8000-$BFFF.
 *
 * @param bank - The bank and its output file.
 * @param segments - The emitted segments in that file.
 * @param length - The file's length.
 * @returns The bank's load address and segment names, or diagnostics.
 */
function verifyBank(bank: BankOutput, segments: EmittedSegment[], length: number): ValidationResult<VerifiedBank> {
  const pointer = `/banks/${bank.index}`;
  const first = segments.reduce((low, segment) => segment.outputOffset < low.outputOffset ? segment : low);
  const loadAddress = first.start - first.outputOffset;
  const diagnostics: ClementinaDiagnostic[] = [];
  for (const segment of segments) {
    if (segment.start - segment.outputOffset !== loadAddress) {
      diagnostics.push(diagnostic('assembler.image.placement', pointer,
        `Segment ${segment.name} starts at ${formatHex(segment.start)}, but its place in ${bank.request.memory}'s file requires ${formatHex(loadAddress + segment.outputOffset)}`));
    }
  }
  if (loadAddress < 0x8000 || loadAddress + length > 0xc000) {
    diagnostics.push(diagnostic('assembler.bank.bounds', pointer,
      `Bank ${bank.request.bank} (${bank.request.memory}) holds ${formatHex(loadAddress)}-${formatHex(loadAddress + Math.max(length, 1) - 1)}; banked code must stay inside $8000-$BFFF`));
  }
  return result({...bank, loadAddress, segments: segments.map(segment => segment.name)}, diagnostics);
}

/**
 * Ensure the entry symbol points inside the linked CPU payload.
 *
 * @param entryAddress - Value of the unique entry symbol.
 * @param loadAddress - CPU address of the first binary byte.
 * @param binaryLength - Number of linked binary bytes.
 * @returns The entry address or an address diagnostic.
 */
function validateEntryAddress(entryAddress: number, loadAddress: number, binaryLength: number): ValidationResult<number> {
  if (entryAddress < 1 || entryAddress > 0xffff) {
    return result<number>(undefined, [
      diagnostic('assembler.entry-address', '/entrySymbol', 'Entry symbol is outside the 16-bit CPU address space'),
    ]);
  }
  if (entryAddress < loadAddress || entryAddress >= loadAddress + binaryLength) {
    return result<number>(undefined, [
      diagnostic('assembler.entry-address', '/entrySymbol', 'Entry symbol is outside the linked PRG payload'),
    ]);
  }
  return result<number>(entryAddress, []);
}

/**
 * Verify emitted segments and the entry symbol before PRG encoding. Segments in
 * the main output make the main image; each bank's output file makes its own.
 *
 * @param paths - Resolved output paths used to identify the linked binary.
 * @param request - Requested load address and entry symbol.
 * @param image - Linked binary and parsed debug records.
 * @param banks - Where each bank's area is written.
 * @returns The verified entry address and banks, or linked-image diagnostics.
 */
export function verifyLinkedImage(
  paths: BuildPaths,
  request: AssemblyBuildRequest,
  image: LinkedImage,
  banks: readonly BankOutput[] = [],
): ValidationResult<VerifiedImage> {
  const emitted = image.debug.segments.filter(isEmittedSegment);
  if (emitted.length === 0) {
    return result<VerifiedImage>(undefined, [
      diagnostic('assembler.image.empty', '', 'ld65 debug data contains no emitted segments'),
    ]);
  }

  const diagnostics: ClementinaDiagnostic[] = [];
  const byFile = new Map(banks.map(bank => [bank.file, [] as EmittedSegment[]]));
  for (const segment of emitted) {
    const file = resolve(paths.root, segment.outputName);
    if (file === paths.output.binary) {
      diagnostics.push(...segmentDiagnostics(segment, request.loadAddress, image.binary.length));
    } else if (byFile.has(file)) {
      byFile.get(file)!.push(segment);
    } else {
      diagnostics.push(diagnostic('assembler.image.multiple-output', '',
        `Segment ${segment.name} is emitted to a separate file (${segment.outputName}); code outside the main output must be in a MEMORY area listed in build.assembly.banks`));
    }
  }

  const verified: VerifiedBank[] = [];
  const segmentBanks: Record<string, number> = {};
  for (const bank of banks) {
    const segments = byFile.get(bank.file)!;
    if (segments.length === 0) {
      diagnostics.push(warning('assembler.bank.empty', `/banks/${bank.index}`,
        `Bank ${bank.request.bank} (${bank.request.memory}) has no code yet, so nothing is loaded into it`));
      continue;
    }
    const checked = verifyBank(bank, segments, image.bankFiles.get(bank.file)?.length ?? 0);
    diagnostics.push(...checked.diagnostics);
    if (!checked.ok) continue;
    verified.push(checked.value);
    for (const name of checked.value.segments) segmentBanks[name] = bank.request.bank;
  }

  const entries = image.debug.symbols.filter(symbol => symbol.name === request.entrySymbol);
  if (entries.length !== 1) {
    const message = entries.length === 0
      ? `Symbol ${request.entrySymbol} is absent from ld65 debug data`
      : `Symbol ${request.entrySymbol} is ambiguous in ld65 debug data`;
    diagnostics.push(diagnostic('assembler.entry-symbol', '/entrySymbol', message));
  }
  if (diagnostics.some(item => item.severity === 'error')) return result<VerifiedImage>(undefined, diagnostics);
  const entry = validateEntryAddress(entries[0]!.value, request.loadAddress, image.binary.length);
  if (!entry.ok) return result<VerifiedImage>(undefined, [...diagnostics, ...entry.diagnostics]);
  return result<VerifiedImage>({entryAddress: entry.value, banks: verified, segmentBanks}, diagnostics);
}
