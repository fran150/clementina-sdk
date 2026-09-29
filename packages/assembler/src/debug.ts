import type {Ca65DebugInfo, DebugLine, DebugSegment, DebugSpan, DebugSymbol} from './types.js';

/**
 * Split one ld65 record into named fields without splitting commas inside quotes.
 *
 * @param text - Comma-separated field text after the record kind.
 * @returns Raw field values keyed by their ld65 names.
 */
function splitAttributes(text: string): Record<string, string> {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quoted) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  fields.push(current);
  return Object.fromEntries(fields.map(field => {
    const equals = field.indexOf('=');
    return equals < 0 ? [field, ''] : [field.slice(0, equals), field.slice(equals + 1)];
  }));
}

/**
 * Decode a quoted ld65 text field, retaining a fallback for malformed escapes.
 *
 * @param value - Raw field value, if present.
 * @returns Decoded text or undefined when the field is absent.
 */
function textValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Read a decimal or 0x-prefixed integer from an ld65 field.
 *
 * @param value - Raw numeric field, if present.
 * @returns Parsed number or undefined when it cannot be parsed.
 */
function integer(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = value.startsWith('0x') ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Read ld65's plus-separated list of numeric record IDs.
 *
 * @param value - Raw list field, if present.
 * @returns Parsed IDs, or an empty list when absent or invalid.
 */
function integerList(value: string | undefined): number[] {
  if (value === undefined || value === '') return [];
  const values = value.split('+').map(integer);
  return values.every(item => item !== undefined) ? values as number[] : [];
}

type Fields = Record<string, string>;

/**
 * Convert one ld65 line record while preserving its optional fields.
 *
 * @param fields - Raw fields from the line record.
 * @returns A source line and its referenced span IDs.
 */
function parseLine(fields: Fields): DebugLine {
  const line: DebugLine = {
    id: integer(fields.id) ?? -1,
    fileId: integer(fields.file) ?? -1,
    line: integer(fields.line) ?? 0,
    spanIds: integerList(fields.span),
  };
  const type = integer(fields.type);
  const count = integer(fields.count);
  if (type !== undefined) line.type = type;
  if (count !== undefined) line.count = count;
  return line;
}

/**
 * Convert one ld65 segment record, including output placement when present.
 *
 * @param fields - Raw fields from the segment record.
 * @returns The parsed segment.
 */
function parseSegment(fields: Fields): DebugSegment {
  const segment: DebugSegment = {
    id: integer(fields.id) ?? -1,
    name: textValue(fields.name) ?? '',
    start: integer(fields.start) ?? 0,
    size: integer(fields.size) ?? 0,
  };
  const outputName = textValue(fields.oname);
  const outputOffset = integer(fields.ooffs);
  if (outputName !== undefined) segment.outputName = outputName;
  if (outputOffset !== undefined) segment.outputOffset = outputOffset;
  return segment;
}

/**
 * Convert one ld65 span record into a segment-relative byte range.
 *
 * @param fields - Raw fields from the span record.
 * @returns The parsed span.
 */
function parseSpan(fields: Fields): DebugSpan {
  const span: DebugSpan = {
    id: integer(fields.id) ?? -1,
    segmentId: integer(fields.seg) ?? -1,
    start: integer(fields.start) ?? 0,
    size: integer(fields.size) ?? 0,
  };
  const typeId = integer(fields.type);
  if (typeId !== undefined) span.typeId = typeId;
  return span;
}

/**
 * Convert an ld65 symbol record when it has a numeric value.
 *
 * @param fields - Raw fields from the symbol record.
 * @returns The parsed symbol, or undefined when its value is missing.
 */
function parseSymbol(fields: Fields): DebugSymbol | undefined {
  const value = integer(fields.val);
  if (value === undefined) return undefined;
  const symbol: DebugSymbol = {
    id: integer(fields.id) ?? -1,
    name: textValue(fields.name) ?? '',
    value,
  };
  const segmentId = integer(fields.seg);
  const definitionLineId = integer(fields.def);
  const scopeId = integer(fields.scope);
  const type = textValue(fields.type);
  if (segmentId !== undefined) symbol.segmentId = segmentId;
  if (definitionLineId !== undefined) symbol.definitionLineId = definitionLineId;
  if (scopeId !== undefined) symbol.scopeId = scopeId;
  if (type !== undefined) symbol.type = type;
  return symbol;
}

/**
 * Parse the record-oriented ld65 debug format used for source mapping.
 *
 * @param text - Complete contents of an ld65 .dbg file.
 * @returns Parsed files, lines, segments, spans, symbols, and format version.
 * @throws TypeError when the debug format major version is not 2.
 */
export function parseCa65Debug(text: string): Ca65DebugInfo {
  const debug: Ca65DebugInfo = {version: {major: 0, minor: 0}, files: [], lines: [], segments: [], spans: [], symbols: []};
  for (const rawLine of text.split(/\r?\n/u)) {
    if (!rawLine) continue;
    const tab = rawLine.indexOf('\t');
    if (tab < 0) continue;
    const kind = rawLine.slice(0, tab);
    const fields = splitAttributes(rawLine.slice(tab + 1));
    switch (kind) {
      case 'version':
        debug.version = {major: integer(fields.major) ?? 0, minor: integer(fields.minor) ?? 0};
        break;
      case 'file':
        debug.files.push({id: integer(fields.id) ?? -1, path: textValue(fields.name) ?? ''});
        break;
      case 'line':
        debug.lines.push(parseLine(fields));
        break;
      case 'seg':
        debug.segments.push(parseSegment(fields));
        break;
      case 'span':
        debug.spans.push(parseSpan(fields));
        break;
      case 'sym': {
        const symbol = parseSymbol(fields);
        if (symbol !== undefined) debug.symbols.push(symbol);
        break;
      }
    }
  }
  if (debug.version.major !== 2) {
    throw new TypeError(`Unsupported ld65 debug format ${debug.version.major}.${debug.version.minor}`);
  }
  return debug;
}
