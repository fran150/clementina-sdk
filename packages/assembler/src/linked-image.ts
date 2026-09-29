import {readFile} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {diagnostic, result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {projectRelativePath, type BuildPaths} from './build-paths.js';
import {parseCa65Debug} from './debug.js';
import type {AssemblyBuildRequest, Ca65DebugInfo, DebugSegment} from './types.js';

export interface LinkedImage {
  binary: Uint8Array;
  debug: Ca65DebugInfo;
}

type EmittedSegment = DebugSegment & {outputName: string; outputOffset: number};

/**
 * Identify a nonempty segment with an output file and binary offset.
 *
 * @param segment - Segment from ld65 debug data.
 * @returns Whether the segment was emitted into a linked file.
 */
function isEmittedSegment(segment: DebugSegment): segment is EmittedSegment {
  return segment.size > 0 && segment.outputName !== undefined && segment.outputOffset !== undefined;
}

/**
 * Format an address for placement diagnostics.
 *
 * @param address - Address or binary offset.
 * @returns Uppercase hexadecimal with a dollar-sign prefix.
 */
function hex(address: number): string {
  return `$${address.toString(16).toUpperCase()}`;
}

/**
 * Read the linked binary and debug records, normalizing project-local source paths.
 *
 * @param paths - Resolved paths for the binary and ld65 debug file.
 * @returns The binary bytes and parsed debug records.
 * @throws If a build file cannot be read or the debug format is unsupported.
 */
export async function readLinkedImage(paths: BuildPaths): Promise<LinkedImage> {
  const [binaryBuffer, debugText] = await Promise.all([
    readFile(paths.output.binary),
    readFile(paths.output.debug, 'utf8'),
  ]);
  const binary = new Uint8Array(binaryBuffer.buffer, binaryBuffer.byteOffset, binaryBuffer.byteLength);
  const debug = parseCa65Debug(debugText);
  debug.files = debug.files.map(file => {
    if (!isAbsolute(file.path)) return file;
    const path = projectRelativePath(paths.root, file.path);
    return path === '..' || path.startsWith('../') ? file : {...file, path};
  });
  return {binary, debug};
}

/**
 * Check one emitted segment against the requested contiguous binary image.
 *
 * @param segment - Segment with an output file and offset.
 * @param paths - Resolved build output paths.
 * @param loadAddress - CPU address requested for the first binary byte.
 * @param binaryLength - Number of linked binary bytes.
 * @returns Placement and bounds diagnostics for this segment.
 */
function segmentDiagnostics(
  segment: EmittedSegment,
  paths: BuildPaths,
  loadAddress: number,
  binaryLength: number,
): ClementinaDiagnostic[] {
  if (resolve(paths.root, segment.outputName) !== paths.output.binary) {
    return [diagnostic('assembler.image.multiple-output', '',
      `Segment ${segment.name} is emitted to a separate file; a Clementina PRG build requires one contiguous output`)];
  }

  const diagnostics: ClementinaDiagnostic[] = [];
  const expected = loadAddress + segment.outputOffset;
  if (segment.start !== expected) {
    diagnostics.push(diagnostic('assembler.image.placement', '',
      `Segment ${segment.name} starts at ${hex(segment.start)}, but binary offset ${hex(segment.outputOffset)} requires ${hex(expected)}`));
  }
  if (segment.outputOffset + segment.size > binaryLength) {
    diagnostics.push(diagnostic('assembler.image.bounds', '',
      `Segment ${segment.name} extends beyond the linked binary`));
  }
  return diagnostics;
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
 * Verify emitted segments and the entry symbol before PRG encoding.
 *
 * @param paths - Resolved output paths used to identify the linked binary.
 * @param request - Requested load address and entry symbol.
 * @param image - Linked binary and parsed debug records.
 * @returns The verified entry address or linked-image diagnostics.
 */
export function verifyLinkedImage(
  paths: BuildPaths,
  request: AssemblyBuildRequest,
  image: LinkedImage,
): ValidationResult<number> {
  const emitted = image.debug.segments.filter(isEmittedSegment);
  if (emitted.length === 0) {
    return result<number>(undefined, [
      diagnostic('assembler.image.empty', '', 'ld65 debug data contains no emitted segments'),
    ]);
  }

  const diagnostics: ClementinaDiagnostic[] = [];
  for (const segment of emitted) {
    diagnostics.push(...segmentDiagnostics(segment, paths, request.loadAddress, image.binary.length));
  }

  const entries = image.debug.symbols.filter(symbol => symbol.name === request.entrySymbol);
  if (entries.length !== 1) {
    const message = entries.length === 0
      ? `Symbol ${request.entrySymbol} is absent from ld65 debug data`
      : `Symbol ${request.entrySymbol} is ambiguous in ld65 debug data`;
    diagnostics.push(diagnostic('assembler.entry-symbol', '/entrySymbol', message));
  }
  if (diagnostics.length) return result<number>(undefined, diagnostics);
  return validateEntryAddress(entries[0].value, request.loadAddress, image.binary.length);
}
