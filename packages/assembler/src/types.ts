import type {PrgLoadStep} from '@clementina/basic';

export interface Ca65Toolchain {
  ca65?: string;
  ld65?: string;
}

export interface AssemblyBuildRequest {
  /** Project-relative assembly sources, in deterministic link order. */
  sources: string[];
  /** Project-relative ld65 configuration. Memory placement remains owned by this file. */
  linkerConfig: string;
  /** Project-relative directory for objects and final artifacts. */
  outputDirectory: string;
  /** Portable artifact stem, without an extension. */
  outputName: string;
  /** Expected first byte address in the linked binary. Checked against ld65 debug data. */
  loadAddress: number;
  /** Exported or scoped label used as the terminal run address. */
  entrySymbol: string;
  /** Required when loadAddress is in $8000-$BFFF. */
  bank?: number;
  includeDirectories?: string[];
  defines?: Record<string, string | number>;
  /** Project-relative ar65 libraries ld65 searches after the objects. */
  libraries?: string[];
  toolchain?: Ca65Toolchain;
}

export interface DebugSourceFile {
  id: number;
  path: string;
}

export interface DebugLine {
  id: number;
  fileId: number;
  line: number;
  spanIds: number[];
  type?: number;
  count?: number;
}

export interface DebugSegment {
  id: number;
  name: string;
  start: number;
  size: number;
  outputName?: string;
  outputOffset?: number;
}

export interface DebugSpan {
  id: number;
  segmentId: number;
  start: number;
  size: number;
  typeId?: number;
}

export interface DebugSymbol {
  id: number;
  name: string;
  value: number;
  segmentId?: number;
  definitionLineId?: number;
  scopeId?: number;
  type?: string;
}
export interface Ca65DebugInfo {
  version: {major: number; minor: number};
  files: DebugSourceFile[];
  lines: DebugLine[];
  segments: DebugSegment[];
  spans: DebugSpan[];
  symbols: DebugSymbol[];
}

export interface SourceLocation {
  path: string;
  line: number;
  address: number;
  size: number;
  lineId: number;
  spanId: number;
  segmentId: number;
  /** Clementina RAM bank supplied by the build request; ld65 debug v2 does not encode it. */
  bank?: number;
}

export interface AssemblySourceMap {
  /**
   * Find all mapped locations associated with one source line.
   *
   * @param path - Source path, matched case-sensitively after normalization.
   * @param line - Positive, one-based source line number.
   * @returns Locations for the line, or an empty array if none exist.
   * @throws RangeError if line is not a positive integer.
   */
  locationsForSource(path: string, line: number): readonly SourceLocation[];
  /**
   * Find source spans containing a logical CPU address.
   *
   * @param address - Logical CPU address in the range 0..65535.
   * @param bank - Optional bank filter; locations without bank metadata also match.
   * @returns All locations containing the address.
   * @throws RangeError if address or bank is outside its accepted range.
   */
  locationsForAddress(address: number, bank?: number): readonly SourceLocation[];
  /**
   * List source lines that map to valid spans.
   *
   * @param path - Source path, matched case-sensitively after normalization.
   * @returns Sorted, one-based line numbers.
   */
  executableLines(path: string): readonly number[];
}

export interface AssemblyBuildResult {
  binary: Uint8Array;
  prg: Uint8Array;
  loadStep: PrgLoadStep;
  entryAddress: number;
  debug: Ca65DebugInfo;
  artifacts: {
    binary: string;
    prg: string;
    debug: string;
    map: string;
    labels: string;
    objects: string[];
    listings: string[];
  };
}

export interface ProcessInvocation {
  command: string;
  args: string[];
  cwd: string;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
/**
 * Run one external tool invocation and capture its completion result.
 *
 * @param invocation - Command, arguments, and working directory to use.
 * @returns The exit code and captured standard output and error.
 */
export type ProcessRunner = (invocation: ProcessInvocation) => Promise<ProcessResult>;
