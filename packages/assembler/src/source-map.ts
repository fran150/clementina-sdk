import type {
  AssemblySourceMap, Ca65DebugInfo, DebugLine, DebugSegment, DebugSpan, SourceLocation,
} from './types.js';

/** Banks for code linked at $8000-$BFFF. */
export interface SourceMapOptions {
  /** The bank of the main image's code there (build.assembly.bank). */
  bank?: number;
  /** Banks by segment name, for build.assembly.banks; they win over `bank`. */
  segmentBanks?: Readonly<Record<string, number>>;
}

/**
 * Normalize debug source paths for consistent, case-sensitive lookups.
 *
 * @param path - A source path from debug data or a query.
 * @returns The path with forward slashes and no leading ./.
 */
function normalizeSourcePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

/**
 * Resolve a line's span to its logical CPU address range.
 *
 * @param path - Normalized source path for the line.
 * @param line - Debug line that references the span.
 * @param spanId - Referenced debug span identifier.
 * @param spans - Debug spans indexed by identifier.
 * @param segments - Debug segments indexed by identifier.
 * @param banks - Bank options: the image's bank and each banked segment's.
 * @returns A source location, or undefined for missing or invalid ranges.
 */
function locationForSpan(
  path: string,
  line: DebugLine,
  spanId: number,
  spans: Map<number, DebugSpan>,
  segments: Map<number, DebugSegment>,
  banks: SourceMapOptions,
): SourceLocation | undefined {
  const span = spans.get(spanId);
  const segment = span === undefined ? undefined : segments.get(span.segmentId);
  if (span === undefined || segment === undefined || span.size < 1) return undefined;

  const address = segment.start + span.start;
  if (address < 0 || address > 0xffff || address + span.size > 0x10000) return undefined;
  // A segment from build.assembly.banks has its own bank; the rest of the window is the image's.
  const bank = address >= 0x8000 && address <= 0xbfff
    ? banks.segmentBanks?.[segment.name] ?? banks.bank
    : undefined;
  return {
    path,
    line: line.line,
    address,
    size: span.size,
    lineId: line.id,
    spanId,
    segmentId: span.segmentId,
    ...(bank === undefined ? {} : {bank}),
  };
}

/**
 * Order source locations consistently by path, line, address, size, and span.
 *
 * @param left - First location to compare.
 * @param right - Second location to compare.
 * @returns A negative, zero, or positive sort result.
 */
function compareLocations(left: SourceLocation, right: SourceLocation): number {
  return left.path.localeCompare(right.path)
    || left.line - right.line
    || left.address - right.address
    || left.size - right.size
    || left.spanId - right.spanId;
}

/**
 * Resolve, deduplicate, and sort valid line-to-span mappings.
 *
 * @param debug - Parsed linker debug records.
 * @param bank - Bank options from the build.
 * @returns Source locations in deterministic order.
 */
function collectLocations(debug: Ca65DebugInfo, bank: SourceMapOptions): SourceLocation[] {
  const files = new Map(debug.files.map(file => [file.id, normalizeSourcePath(file.path)]));
  const segments = new Map(debug.segments.map(segment => [segment.id, segment]));
  const spans = new Map(debug.spans.map(span => [span.id, span]));
  const locations: SourceLocation[] = [];
  const seen = new Set<string>();

  for (const line of debug.lines) {
    const path = files.get(line.fileId);
    if (path === undefined || line.line < 1) continue;
    for (const spanId of line.spanIds) {
      const location = locationForSpan(path, line, spanId, spans, segments, bank);
      if (location === undefined) continue;
      const key = `${path}\0${line.line}\0${location.address}\0${location.size}\0${location.bank ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push(location);
    }
  }
  return locations.sort(compareLocations);
}

/**
 * Group locations by normalized source path and line number.
 *
 * @param locations - Resolved source locations.
 * @returns An index from path to line to locations.
 */
function indexBySource(locations: readonly SourceLocation[]): Map<string, Map<number, SourceLocation[]>> {
  const index = new Map<string, Map<number, SourceLocation[]>>();
  for (const location of locations) {
    let lines = index.get(location.path);
    if (lines === undefined) {
      lines = new Map();
      index.set(location.path, lines);
    }
    const lineLocations = lines.get(location.line) ?? [];
    lineLocations.push(location);
    lines.set(location.line, lineLocations);
  }
  return index;
}

/**
 * Build a source/address index from ld65 debug records.
 *
 * @param debug - Parsed linker debug records.
 * @param options - The bank of the image's code at $8000-$BFFF, and the bank
 * of each segment from build.assembly.banks (AssemblyBuildResult.segmentBanks).
 * @returns Queries for source locations, address locations, and executable lines.
 * @throws RangeError if a bank is not an integer from 1 through 31.
 */
export function createAssemblySourceMap(debug: Ca65DebugInfo, options: SourceMapOptions = {}): AssemblySourceMap {
  const banks = [options.bank, ...Object.values(options.segmentBanks ?? {})];
  if (banks.some(bank => bank !== undefined && (!Number.isInteger(bank) || bank < 1 || bank > 31))) {
    throw new RangeError('bank must be 1..31');
  }
  const locations = collectLocations(debug, options);
  const bySource = indexBySource(locations);

  return {
    /**
     * Find all mapped locations associated with one source line.
     *
     * @param path - Source path, matched case-sensitively after normalization.
     * @param line - Positive, one-based source line number.
     * @returns A copy of the matching locations.
     * @throws RangeError if line is not a positive integer.
     */
    locationsForSource(path, line) {
      if (!Number.isInteger(line) || line < 1) throw new RangeError('line must be a positive integer');
      return [...(bySource.get(normalizeSourcePath(path))?.get(line) ?? [])];
    },
    /**
     * Find source spans containing a logical CPU address.
     *
     * @param address - Logical CPU address in the range 0..65535.
     * @param bank - Optional bank filter; locations without bank metadata also match.
     * @returns All locations containing the address.
     * @throws RangeError if address or bank is outside its accepted range.
     */
    locationsForAddress(address, bank) {
      if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
        throw new RangeError('Invalid CPU address');
      }
      if (bank !== undefined && (!Number.isInteger(bank) || bank < 0 || bank > 31)) {
        throw new RangeError('bank must be 0..31');
      }
      return locations.filter(location =>
        address >= location.address
        && address < location.address + location.size
        && (bank === undefined || location.bank === undefined || location.bank === bank));
    },
    /**
     * List source lines that map to valid spans.
     *
     * @param path - Source path, matched case-sensitively after normalization.
     * @returns Sorted, one-based line numbers.
     */
    executableLines(path) {
      const lines = bySource.get(normalizeSourcePath(path));
      return lines === undefined ? [] : [...lines.keys()].sort((left, right) => left - right);
    },
  };
}
