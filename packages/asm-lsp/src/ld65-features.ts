/**
 * Editor features for ld65 linker configurations: checks (ld65's rules plus
 * where the memory areas land in Clementina's memory map), hover, completion,
 * go to definition and the outline.
 */
import {
  attributeSpecs, blockSpec, booleanValues, cfgBlocks, cfgNumber, configEvaluator, configSymbols, percentDocs, startAddressOf, tokenSpan,
  type CfgAttribute, type CfgAttributeSpec, type CfgBlock, type CfgItem, type CfgToken, type ParsedConfig,
} from './ld65-config.js';
import {BASIC_START, DEFAULT_MEMORY_TOP, clementinaMemoryMap, hex, memoryAt, range, type MemoryMapEntry} from './clementina-memory.js';
import type {Span} from './parser.js';

/** What the project says about the program the configuration links. */
export interface ConfigProject {
  /** True when a BASIC program runs (`program.entry`), so BASIC's memory must survive. */
  returnsToBasic: boolean;
  /** `build.basic.memoryTop`: BASIC's MEMSIZ, $C000 when unset. */
  memoryTop?: number;
  /** `build.assembly.loadAddress`. */
  loadAddress?: number;
  /** True when this file is the project's `build.assembly.linkerConfig`. */
  linked: boolean;
  /** Segments the project's assembly sources put code or data in. */
  segments: Array<{name: string; file: string; line: number}>;
}

export interface ConfigDiagnostic {
  span: Span;
  severity: 'error' | 'warning' | 'information';
  message: string;
}

export interface MemoryArea {
  item: CfgItem;
  start?: number;
  size?: number;
  bank?: number;
  /** The output file: `%O`, a file name, or `""` for none. ld65 writes to `%O` when `file` is not given. */
  file: string;
}

export interface SegmentPlacement {
  item: CfgItem;
  load?: string;
  run?: string;
  type: string;
}

const attribute = (item: CfgItem, key: string) => item.attributes.find(entry => entry.key === key);
const blocksOf = (config: ParsedConfig, key: string) => config.blocks.filter(block => block.key === key);
const itemsOf = (config: ParsedConfig, key: string) => blocksOf(config, key).flatMap(block => block.items);
const within = (span: Span, line: number, character: number) => span.line === line && character >= span.start && character <= span.end;

/** The memory areas, with what can be computed of their placement. */
export function memoryAreas(config: ParsedConfig): MemoryArea[] {
  const evaluate = configEvaluator(config);
  return itemsOf(config, 'MEMORY').map(item => {
    const number = (key: string) => {
      const value = attribute(item, key)?.value;
      return value ? evaluate(value.tokens).value : undefined;
    };
    const fileValue = attribute(item, 'file')?.value?.text;
    const start = number('start'), size = number('size'), bank = number('bank');
    return {item, file: fileValue ?? '%O', ...(start !== undefined ? {start} : {}), ...(size !== undefined ? {size} : {}), ...(bank !== undefined ? {bank} : {})};
  });
}

export function segmentPlacements(config: ParsedConfig): SegmentPlacement[] {
  return itemsOf(config, 'SEGMENTS').map(item => {
    const load = attribute(item, 'load')?.value?.text, run = attribute(item, 'run')?.value?.text;
    return {item, type: attribute(item, 'type')?.value?.text.toLowerCase() ?? 'ro', ...(load ? {load} : {}), ...(run ? {run} : {})};
  });
}

const areaRange = (area: MemoryArea) => (area.start !== undefined && area.size !== undefined ? range(area.start, area.start + Math.max(area.size, 1)) : undefined);

/** The memory-map entries an area takes, minus BASIC's in another extended RAM bank. */
function areaMemory(area: MemoryArea, memoryTop?: number): MemoryMapEntry[] {
  if (area.start === undefined || area.size === undefined || area.size <= 0) return [];
  return memoryAt(area.start, area.start + area.size, memoryTop).filter(entry =>
    !(entry.use === 'basic' && area.bank && area.start! >= 0x8000));
}

// --- Checks ------------------------------------------------------------------

export function configDiagnostics(config: ParsedConfig, project?: ConfigProject): ConfigDiagnostic[] {
  const out: ConfigDiagnostic[] = config.problems.map(problem => ({...problem}));
  const error = (span: Span, message: string) => out.push({span, severity: 'error', message});
  const warning = (span: Span, message: string) => out.push({span, severity: 'warning', message});
  const evaluate = configEvaluator(config);
  const symbols = configSymbols(config);
  const memoryNames = new Set(itemsOf(config, 'MEMORY').map(item => item.name));
  const segmentNames = new Set(itemsOf(config, 'SEGMENTS').map(item => item.name));

  // ld65 needs the memory areas before anything refers to them.
  let seenMemory = false;
  for (const block of config.blocks) {
    if (block.key === 'MEMORY') seenMemory = true;
    if ((block.key === 'FILES' || block.key === 'SEGMENTS') && !seenMemory) error(block.span, `MEMORY must come before ${block.key}`);
  }

  for (const key of ['MEMORY', 'SEGMENTS', 'SYMBOLS', 'FILES']) {
    const seen = new Map<string, CfgItem>();
    for (const item of itemsOf(config, key)) {
      if (seen.has(item.name)) error(item.span, `${item.name} is defined twice in ${key} (first on line ${seen.get(item.name)!.span.line + 1})`);
      else seen.set(item.name, item);
    }
  }

  for (const block of config.blocks) {
    const spec = blockSpec(block.key);
    if (!spec) continue;
    for (const item of block.items) {
      if (spec.itemNames && !spec.itemNames.some(entry => entry.name.toLowerCase() === item.name.toLowerCase())) {
        error(item.span, `${block.key} has ${spec.itemNames.map(entry => entry.name).join(', ')}, not ${item.name}`);
        continue;
      }
      const specs = attributeSpecs(block.key, item.name);
      const seen = new Set<string>();
      for (const entry of item.attributes) {
        const attributeSpec = specs.find(candidate => candidate.name === entry.key);
        if (!attributeSpec) {
          error(entry.span, specs.length
            ? `${entry.name} is not an attribute of ${describeItem(block, item)}; it takes ${specs.map(candidate => candidate.name).join(', ')}`
            : `${describeItem(block, item)} takes no attributes`);
          continue;
        }
        if (seen.has(entry.key)) error(entry.span, `${entry.name} is given twice`);
        seen.add(entry.key);
        checkValue(block, item, entry, attributeSpec);
      }
      for (const required of specs.filter(candidate => candidate.required)) {
        if (!seen.has(required.name)) error(item.span, `${item.name} needs ${required.name} (${required.doc.replace(/\.$/u, '').toLowerCase()})`);
      }
      if (block.key === 'SYMBOLS') {
        const type = attribute(item, 'type')?.value?.text.toLowerCase();
        if (type === 'import' && attribute(item, 'value')) error(attribute(item, 'value')!.span, 'An import must not have a value: an object file defines it');
        if ((type === 'export' || type === 'weak') && !attribute(item, 'value')) error(item.span, `A${type === 'export' ? 'n export' : ' weak symbol'} needs a value`);
      }
      if (block.key === 'SEGMENTS') {
        const placed = ['align', 'start', 'offset'].map(key => attribute(item, key)).filter((entry): entry is CfgAttribute => !!entry);
        if (placed.length > 1) error(placed[1]!.span, 'Only one of align, start and offset may be used');
      }
    }
  }

  function checkValue(block: CfgBlock, item: CfgItem, entry: CfgAttribute, spec: CfgAttributeSpec): void {
    const value = entry.value;
    if (!value) return;
    const single = value.tokens.length === 1 ? value.tokens[0]! : undefined;
    const allowed = (list: string[]) => list.map(name => `\`${name}\``).join(', ');
    switch (spec.type) {
      case 'enum':
      case 'boolean': {
        const values = spec.type === 'boolean' ? booleanValues : spec.values!;
        if (!single || single.kind !== 'identifier' || !values.includes(single.text.toLowerCase())) error(value.span, `${entry.name} is ${allowed(spec.type === 'boolean' ? ['yes', 'no'] : values)}, not ${value.text}`);
        return;
      }
      case 'memory':
        if (!single || single.kind !== 'identifier') error(value.span, `${entry.name} names a memory area`);
        else if (!memoryNames.has(single.text)) {
          const near = [...memoryNames].find(name => name.toLowerCase() === single.text.toLowerCase());
          error(value.span, `No memory area is named ${single.text}${near ? ` (names are case-sensitive: ${near})` : memoryNames.size ? `; MEMORY has ${[...memoryNames].join(', ')}` : ''}`);
        }
        return;
      case 'segment':
        if (!single || single.kind !== 'identifier') error(value.span, `${entry.name} names a segment`);
        else if (segmentNames.size && !segmentNames.has(single.text)) warning(value.span, `SEGMENTS has no ${single.text}`);
        return;
      case 'identifier':
        if (!single || single.kind !== 'identifier') error(value.span, `${entry.name} is a symbol name`);
        return;
      case 'file':
        if (!single || !(single.kind === 'string' || single.text === '%O')) error(value.span, `${entry.name} is %O or a file name in quotes`);
        return;
      case 'expression': {
        const result = evaluate(value.tokens);
        if (result.error) {
          error(result.error.token ? tokenSpan(result.error.token) : value.span, result.error.message);
          return;
        }
        const unknown = result.symbols.filter(token => !symbols.has(token.text));
        if (block.key === 'MEMORY' && (entry.key === 'start' || entry.key === 'size') && unknown.length) {
          error(tokenSpan(unknown[0]!), `${unknown[0]!.text} is not defined in SYMBOLS, so ld65 cannot compute ${item.name}'s ${entry.key}`);
        }
        return;
      }
      default:
    }
  }

  const areas = memoryAreas(config);
  const segments = segmentPlacements(config);
  const memoryTop = project?.memoryTop;
  const top = memoryTop ?? DEFAULT_MEMORY_TOP;
  const usedBy = (area: MemoryArea) => segments.filter(segment => segment.load === area.item.name || segment.run === area.item.name);

  for (const area of areas) {
    if (area.start === undefined || area.size === undefined) continue;
    const span = area.item.span;
    const end = area.start + area.size;
    if (area.size <= 0) { warning(attribute(area.item, 'size')?.value?.span ?? span, `${area.item.name} has no room: its size is ${area.size}`); continue; }
    if (end > 0x10000) warning(attribute(area.item, 'size')?.value?.span ?? span, `${area.item.name} ends at ${hex(end - 1, 5)}, past the 65C02's 64 KiB ($0000-$FFFF)`);
    const holdsSomething = usedBy(area).length > 0;
    for (const entry of areaMemory(area, memoryTop)) {
      const where = `${area.item.name} (${areaRange(area)}) overlaps ${entry.name} (${range(entry.start, entry.end)})`;
      if (entry.use === 'system') warning(span, `${where}: ${entry.description}`);
      if (entry.use === 'device' && holdsSomething) warning(span, `${where}: ${entry.description}`);
      if (entry.use === 'wozmon') out.push({span, severity: 'information', message: `${where}: ${entry.description}`});
      if (entry.use === 'basic') {
        if (!project) {
          out.push({span, severity: 'information', message: `${where}: ${entry.description} Fine for a program that replaces BASIC; one called from BASIC must stay out of it.`});
        } else if (project.returnsToBasic) {
          const hint = entry.start === BASIC_START
            ? area.start >= BASIC_START
              ? ` Set build.basic.memoryTop to ${hex(area.start)} in clementina.yaml so BASIC stays below ${area.item.name}${memoryTop !== undefined ? ` (it is ${hex(memoryTop)})` : ''}.`
              : ` Move ${area.item.name} above build.basic.memoryTop (${hex(top)}).`
            : ' The program returns to BASIC (program.entry), so it must leave these bytes alone.';
          warning(span, `${where}: ${entry.description}${hint}`);
        }
      }
    }
  }

  // Overlapping memory areas: ld65 allows it (for overlays), so it is only a warning.
  areas.forEach((area, index) => {
    if (area.start === undefined || area.size === undefined || area.size <= 0) return;
    for (const other of areas.slice(0, index)) {
      if (other.start === undefined || other.size === undefined || other.size <= 0) continue;
      if ((area.bank ?? 0) !== (other.bank ?? 0)) continue;
      if (area.start < other.start + other.size && other.start < area.start + area.size) {
        warning(area.item.span, `${area.item.name} (${areaRange(area)}) overlaps memory area ${other.item.name} (${areaRange(other)})`);
      }
    }
  });

  for (const segment of segments) {
    if (segment.type !== 'zp') continue;
    const area = areas.find(candidate => candidate.item.name === segment.load);
    if (area?.start !== undefined && area.size !== undefined && area.start + area.size > 0x100) {
      warning(attribute(segment.item, 'load')!.value!.span, `${segment.item.name} is a zp segment, but ${area.item.name} (${areaRange(area)}) is not all in zero page ($00-$FF)`);
    }
  }

  if (project?.linked) {
    // The binary's first byte comes from the first area written to %O that holds bytes.
    const first = areas.find(area => area.file === '%O' && segments.some(segment => segment.load === area.item.name && !['bss', 'zp'].includes(segment.type)));
    if (first && first.start !== undefined && project.loadAddress !== undefined && first.start !== project.loadAddress) {
      warning(attribute(first.item, 'start')?.value?.span ?? first.item.span,
        `clementina.yaml loads the code at ${hex(project.loadAddress)} (build.assembly.loadAddress), but ${first.item.name}, the first area written to the output, starts at ${hex(first.start)}. The build fails unless they match.`);
    }
    const segmentsBlock = blocksOf(config, 'SEGMENTS')[0];
    const missing = new Map<string, {file: string; line: number}>();
    for (const used of project.segments) if (!segmentNames.has(used.name) && !missing.has(used.name)) missing.set(used.name, used);
    for (const [name, used] of missing) {
      warning(segmentsBlock?.span ?? {line: 0, start: 0, end: 0},
        `${used.file}:${used.line + 1} puts code or data in segment ${name}, which SEGMENTS does not place: ld65 will fail with "Missing memory area assignment for segment '${name}'"`);
    }
  }
  return out;
}

function describeItem(block: CfgBlock, item: CfgItem): string {
  switch (block.key) {
    case 'MEMORY': return 'a memory area';
    case 'SEGMENTS': return 'a segment';
    case 'SYMBOLS': return 'a symbol';
    case 'FILES': return 'a file';
    default: return item.name;
  }
}

// --- Positions ---------------------------------------------------------------

interface Located {
  block?: CfgBlock;
  item?: CfgItem;
  attribute?: CfgAttribute;
  token?: CfgToken;
}

function locate(config: ParsedConfig, line: number, character: number): Located {
  const token = config.tokens.find(candidate => candidate.line === line && character >= candidate.start && character <= candidate.end && candidate.kind !== 'punctuation')
    ?? config.tokens.find(candidate => candidate.line === line && character >= candidate.start && character <= candidate.end);
  for (const block of config.blocks) {
    if (within(block.span, line, character)) return {block, ...(token ? {token} : {})};
    for (const item of block.items) {
      if (within(item.span, line, character)) return {block, item, ...(token ? {token} : {})};
      for (const entry of item.attributes) {
        if (within(entry.span, line, character)) return {block, item, attribute: entry, ...(token ? {token} : {})};
        const value = entry.value;
        if (value && value.tokens.some(candidate => candidate === token)) return {block, item, attribute: entry, ...(token ? {token} : {})};
      }
    }
  }
  return token ? {token} : {};
}

/** The definition a name at a position refers to: a memory area, segment or symbol. */
export function configDefinition(config: ParsedConfig, line: number, character: number): Span | undefined {
  const {block, item, attribute: entry, token} = locate(config, line, character);
  if (!token || token.kind !== 'identifier' || !entry || !block || !item) return undefined;
  if (token === entry.value?.tokens[0] || entry.value?.tokens.includes(token)) {
    const spec = attributeSpecs(block.key, item.name).find(candidate => candidate.name === entry.key);
    const target = spec?.type === 'memory' ? itemsOf(config, 'MEMORY') : spec?.type === 'segment' ? itemsOf(config, 'SEGMENTS') : spec?.type === 'expression' ? itemsOf(config, 'SYMBOLS') : [];
    return target.find(candidate => candidate.name === token.text)?.span;
  }
  return undefined;
}

// --- Hover -------------------------------------------------------------------

export interface ConfigHover {
  markdown: string;
  span: Span;
}

const segmentDocs: Record<string, string> = {
  CODE: 'Code: `.code` and `.segment "CODE"`.',
  RODATA: 'Read-only data: `.rodata`, tables and strings.',
  DATA: 'Initialized data that the program changes: `.data`.',
  BSS: 'Uninitialized data: `.bss` and `.res`. It takes no room in the file; clear it at start up if the code expects zeros.',
  ZEROPAGE: 'Zero-page variables: `.zeropage`. ca65 addresses its labels with zero-page instructions.',
  ONCE: 'Code that runs once at start up (cc65\'s runtime).',
  STARTUP: 'cc65\'s start-up code.',
  INIT: 'Initialization data (cc65\'s runtime).',
  HEADER: 'A file header written before the code.',
  LOWCODE: 'Code that must stay in low memory (cc65\'s runtime).',
};

function memoryLines(area: MemoryArea, project?: ConfigProject): string[] {
  const entries = areaMemory(area, project?.memoryTop);
  if (!entries.length) return [];
  const flag = (entry: MemoryMapEntry) => {
    if (entry.use === 'free') return '';
    if (entry.use === 'basic') return project?.returnsToBasic === false ? ' (BASIC\'s; this program replaces BASIC)' : ' ⚠ BASIC\'s';
    if (entry.use === 'wozmon') return ' (WozMon\'s)';
    if (entry.use === 'device') return ' ⚠ not RAM';
    return ' ⚠ the system\'s';
  };
  return ['', '**Clementina memory**', '', ...entries.map(entry => `- ${range(Math.max(entry.start, area.start!), Math.min(entry.end, area.start! + area.size!))} in ${entry.name}${flag(entry)}: ${entry.description}`)];
}

function memoryHover(config: ParsedConfig, area: MemoryArea, project?: ConfigProject): string {
  const lines = [`**${area.item.name}**: memory area${areaRange(area) ? ` ${areaRange(area)}` : ''}`, ''];
  if (area.size !== undefined) lines.push(`- size: ${hex(area.size)} (${area.size} bytes)`);
  if (area.start !== undefined && area.size !== undefined) lines.push(`- ends at ${hex(area.start + area.size - 1)}; the next free byte is ${hex(area.start + area.size)}`);
  lines.push(`- written to: ${area.file === '""' ? 'no file (reserved RAM)' : area.file === '%O' ? '`%O`, the program file' : area.file}`);
  const type = attribute(area.item, 'type')?.value?.text;
  if (type) lines.push(`- type: ${type}`);
  if (area.bank !== undefined) lines.push(`- bank: ${area.bank}`);
  const placed = segmentPlacements(config).filter(segment => segment.load === area.item.name || segment.run === area.item.name);
  if (placed.length) lines.push(`- segments: ${placed.map(segment => `${segment.item.name} (${segment.type})`).join(', ')}`);
  if (attribute(area.item, 'define')?.value?.text.match(/^(yes|true)$/iu)) lines.push(`- defines \`__${area.item.name}_START__\`, \`__${area.item.name}_SIZE__\` and \`__${area.item.name}_LAST__\``);
  lines.push(...memoryLines(area, project));
  return lines.join('\n');
}

function segmentHover(config: ParsedConfig, segment: SegmentPlacement, project?: ConfigProject): string {
  const areas = memoryAreas(config);
  const describe = (name?: string) => {
    const area = areas.find(candidate => candidate.item.name === name);
    return area && areaRange(area) ? `${name} (${areaRange(area)})` : name ?? '?';
  };
  const lines = [`**${segment.item.name}**: segment, type ${segment.type}`, ''];
  const doc = segmentDocs[segment.item.name];
  if (doc) lines.push(doc, '');
  lines.push(`- loaded into ${describe(segment.load)}`);
  if (segment.run && segment.run !== segment.load) lines.push(`- runs from ${describe(segment.run)}`);
  if (attribute(segment.item, 'define')?.value?.text.match(/^(yes|true)$/iu)) lines.push(`- defines \`__${segment.item.name}_LOAD__\`, \`__${segment.item.name}_RUN__\` and \`__${segment.item.name}_SIZE__\``);
  const used = project?.segments.filter(entry => entry.name === segment.item.name) ?? [];
  if (project) lines.push(used.length ? `- used in ${used.slice(0, 6).map(entry => `${entry.file}:${entry.line + 1}`).join(', ')}${used.length > 6 ? ` and ${used.length - 6} more` : ''}` : '- not used by the project\'s sources (the Clementina library may still use it)');
  return lines.join('\n');
}

function numberHover(value: number, project?: ConfigProject): string {
  const lines = [`**${hex(value, value < 0x100 ? 2 : 4)}** = ${value}`];
  if (value >= 0 && value < 0x10000) {
    const entry = clementinaMemoryMap(project?.memoryTop).find(candidate => value >= candidate.start && value < candidate.end);
    if (entry) lines.push('', `As an address: ${entry.name} (${range(entry.start, entry.end)}). ${entry.description}`);
  }
  return lines.join('\n');
}

function attributeHover(spec: CfgAttributeSpec): string {
  const values = spec.type === 'boolean' ? ['yes', 'no'] : spec.values;
  return [`**${spec.name}**${spec.required ? ' (required)' : ''}`, '', spec.doc, ...(values ? ['', `Values: ${values.map(value => `\`${value}\``).join(', ')}`] : [])].join('\n');
}

export function configHover(config: ParsedConfig, line: number, character: number, project?: ConfigProject): ConfigHover | undefined {
  const {block, item, attribute: entry, token} = locate(config, line, character);
  if (!token) return undefined;
  const span = tokenSpan(token);
  const result = (markdown: string) => ({markdown, span});
  const areas = memoryAreas(config);
  const segments = segmentPlacements(config);

  if (token.kind === 'number') {
    const value = cfgNumber(token.text);
    return value === undefined ? undefined : result(numberHover(value, project));
  }
  if (token.kind === 'percent') {
    const doc = percentDocs[token.text];
    if (!doc) return undefined;
    return result(`**${token.text}**\n\n${doc}${token.text === '%S' ? `\n\nHere: ${hex(startAddressOf(config))}` : ''}`);
  }
  if (block && !item && token.kind === 'identifier') {
    const spec = blockSpec(block.key);
    return spec && result(`**${spec.name}**\n\n${spec.doc}\n\n\`\`\`\n${spec.name} {\n  ${spec.example}\n}\n\`\`\``);
  }
  if (!block || !item) return undefined;
  if (!entry) {
    if (block.key === 'MEMORY') {
      const area = areas.find(candidate => candidate.item === item);
      return area && result(memoryHover(config, area, project));
    }
    if (block.key === 'SEGMENTS') {
      const segment = segments.find(candidate => candidate.item === item);
      return segment && result(segmentHover(config, segment, project));
    }
    if (block.key === 'SYMBOLS') return result(symbolHover(config, item.name) ?? `**${item.name}**: symbol`);
    const named = blockSpec(block.key)?.itemNames?.find(candidate => candidate.name.toLowerCase() === item.name.toLowerCase());
    if (named) return result(`**${named.name}**\n\n${named.doc}`);
    if (item.nameKind === 'percent' && percentDocs[item.name]) return result(`**${item.name}**\n\n${percentDocs[item.name]}`);
    return undefined;
  }
  const spec = attributeSpecs(block.key, item.name).find(candidate => candidate.name === entry.key);
  if (!spec) return undefined;
  if (token === config.tokens.find(candidate => candidate.line === entry.span.line && candidate.start === entry.span.start)) return result(attributeHover(spec));
  if (token.kind !== 'identifier') return undefined;
  if (spec.type === 'memory') {
    const area = areas.find(candidate => candidate.item.name === token.text);
    return area && result(memoryHover(config, area, project));
  }
  if (spec.type === 'segment') {
    const segment = segments.find(candidate => candidate.item.name === token.text);
    return segment && result(segmentHover(config, segment, project));
  }
  if (spec.type === 'expression') {
    const markdown = symbolHover(config, token.text);
    return markdown ? result(markdown) : result(`**${token.text}**: not defined in SYMBOLS${/^__\w+_(?:START|SIZE|LAST|LOAD|RUN)__$/u.test(token.text) ? '; ld65 defines it for a memory area or segment with `define = yes`' : ''}`);
  }
  return result(attributeHover(spec));
}

function symbolHover(config: ParsedConfig, name: string): string | undefined {
  const symbol = configSymbols(config).get(name);
  if (!symbol) return undefined;
  const type = attribute(symbol.item, 'type')?.value?.text ?? 'export';
  const value = symbol.tokens ? configEvaluator(config)(symbol.tokens).value : undefined;
  return [`**${name}**: ${type} symbol`, ...(symbol.tokens ? ['', `= ${symbol.tokens.map(token => token.text).join(' ')}${value !== undefined ? ` = ${hex(value, value < 0x100 ? 2 : 4)} (${value})` : ''}`] : [])].join('\n');
}

// --- Completion --------------------------------------------------------------

/** A hex number for a snippet, where `$` must be escaped. */
const snippetHex = (value: number) => `\\${hex(value, value < 0x100 ? 2 : 4)}`;

export type ConfigCompletionKind = 'block' | 'item' | 'attribute' | 'value' | 'memory' | 'segment' | 'symbol';

export interface ConfigCompletion {
  label: string;
  kind: ConfigCompletionKind;
  detail?: string;
  documentation?: string;
  /** A snippet in LSP syntax (`${1:RAM}`), when the text inserted differs from the label. */
  snippet?: string;
}

/** Where the cursor is, from the tokens before it. */
function completionContext(config: ParsedConfig, line: number, character: number) {
  const before = config.tokens.filter(token => token.line < line || (token.line === line && token.end <= character));
  // A word being typed at the cursor is the prefix, not context.
  if (before.length && before.at(-1)!.line === line && before.at(-1)!.end === character && ['identifier', 'percent'].includes(before.at(-1)!.kind)) before.pop();
  let block: CfgBlock | undefined;
  let itemStart = 0;
  for (let index = 0; index < before.length; index += 1) {
    const token = before[index]!;
    if (token.kind !== 'punctuation') continue;
    if (token.text === '{') {
      const head = before[index - 1];
      block = config.blocks.find(candidate => head && candidate.span.line === head.line && candidate.span.start === head.start);
      itemStart = index + 1;
    } else if (token.text === '}') {
      block = undefined;
      itemStart = index + 1;
    } else if (token.text === ';') {
      itemStart = index + 1;
    }
  }
  const item = before.slice(itemStart);
  return {block, item};
}

export function configCompletions(config: ParsedConfig, line: number, character: number, project?: ConfigProject): ConfigCompletion[] {
  const {block, item} = completionContext(config, line, character);
  if (!block) {
    if (item.length) return [];
    return cfgBlocks.map(spec => ({label: spec.name, kind: 'block', detail: 'ld65 block', documentation: spec.doc, snippet: `${spec.name} {\n\t$0\n}`}));
  }
  const areas = memoryAreas(config);
  if (!item.length) return itemCompletions(config, block, areas, project);
  const colon = item.findIndex(token => token.kind === 'punctuation' && token.text === ':');
  if (colon < 0) return [];
  const name = item[0]!.text.replace(/^"|"$/gu, '');
  const specs = attributeSpecs(block.key, name);
  const last = item.at(-1)!;
  if (last.kind === 'punctuation' && last.text === '=') {
    const key = item.at(-2)?.text.toLowerCase();
    const spec = specs.find(candidate => candidate.name === key);
    return spec ? valueCompletions(config, block, spec, areas, project) : [];
  }
  // A name, ':', or a finished value: another attribute can follow.
  const used = new Set(item.filter((token, index) => token.kind === 'identifier' && item[index + 1]?.text === '=').map(token => token.text.toLowerCase()));
  return specs.filter(spec => !used.has(spec.name)).map(spec => ({
    label: spec.name, kind: 'attribute', detail: spec.required ? 'required' : spec.type, documentation: attributeHover(spec), snippet: `${spec.name} = $0`,
  }));
}

function itemCompletions(config: ParsedConfig, block: CfgBlock, areas: MemoryArea[], project?: ConfigProject): ConfigCompletion[] {
  const spec = blockSpec(block.key);
  if (!spec) return [];
  if (spec.itemNames) return spec.itemNames.map(entry => ({label: entry.name, kind: 'item', documentation: entry.doc, snippet: `${entry.name}: $0;`}));
  if (block.key === 'FILES') return [{label: '%O', kind: 'item', documentation: percentDocs['%O'], snippet: '%O: format = ${1:bin};'}];
  if (block.key === 'MEMORY') {
    const top = project?.memoryTop ?? DEFAULT_MEMORY_TOP;
    const codeStart = project?.loadAddress ?? (project?.memoryTop !== undefined ? project.memoryTop : 0x7000);
    const codeEnd = codeStart < 0x8000 ? 0x8000 : 0xc000;
    const items: ConfigCompletion[] = [
      {label: 'ZP', kind: 'item', detail: 'program zero page $98-$DF', documentation: 'The 72 zero-page bytes Clementina leaves to programs.', snippet: 'ZP: start = \\$98, size = \\$48, type = rw, file = "";'},
      {label: 'RAM', kind: 'item', detail: `${range(codeStart, codeEnd)}`, documentation: `RAM for the program${project?.loadAddress !== undefined ? ', at build.assembly.loadAddress' : codeStart >= top ? ', above BASIC\'s MEMSIZ' : ''}, written to the program file.`,
        snippet: `RAM: start = ${snippetHex(codeStart)}, size = ${snippetHex(codeEnd - codeStart)}, type = rw, file = %O;`},
      {label: 'PAGE2', kind: 'item', detail: 'program page $0280-$02F7', documentation: '120 bytes in page 2 that nothing in the system writes.', snippet: 'PAGE2: start = \\$0280, size = \\$78, type = rw, file = "";'},
    ];
    const names = new Set(areas.map(area => area.item.name));
    return items.filter(entry => !names.has(entry.label));
  }
  if (block.key === 'SEGMENTS') {
    const defined = new Set(segmentPlacements(config).map(segment => segment.item.name));
    const zp = areas.find(area => area.start !== undefined && area.start < 0x100)?.item.name ?? 'ZP';
    const ram = areas.find(area => area.start === undefined || area.start >= 0x100)?.item.name ?? 'RAM';
    const fromSources = [...new Set(project?.segments.map(entry => entry.name) ?? [])];
    const names = [...fromSources, ...Object.keys(segmentDocs).filter(name => !fromSources.includes(name))];
    return names.filter(name => !defined.has(name)).map(name => {
      const type = name === 'ZEROPAGE' ? 'zp' : name === 'BSS' ? 'bss' : name === 'DATA' ? 'rw' : 'ro';
      return {
        label: name, kind: 'segment', detail: fromSources.includes(name) ? 'used by the sources' : 'segment',
        ...(segmentDocs[name] ? {documentation: segmentDocs[name]} : {}),
        snippet: `${name}: load = \${1:${type === 'zp' ? zp : ram}}, type = ${type}${type === 'bss' ? ', define = yes' : ''};`,
      };
    });
  }
  return [];
}

function valueCompletions(config: ParsedConfig, block: CfgBlock, spec: CfgAttributeSpec, areas: MemoryArea[], project?: ConfigProject): ConfigCompletion[] {
  switch (spec.type) {
    case 'enum':
    case 'boolean':
      return (spec.type === 'boolean' ? ['yes', 'no'] : spec.values!).map(value => ({label: value, kind: 'value', documentation: spec.doc}));
    case 'memory':
      return areas.map(area => ({label: area.item.name, kind: 'memory', ...(areaRange(area) ? {detail: areaRange(area)} : {}), documentation: memoryHover(config, area, project)}));
    case 'segment':
      return segmentPlacements(config).map(segment => ({label: segment.item.name, kind: 'segment', detail: segment.type}));
    case 'file':
      return [{label: '%O', kind: 'value', documentation: percentDocs['%O']}, {label: '""', kind: 'value', documentation: 'No file: the area is only reserved, as zero page or BSS-only RAM is.'}];
    case 'expression': {
      const symbols = [...configSymbols(config).keys()].map(name => ({label: name, kind: 'symbol' as const, detail: 'SYMBOLS'}));
      if (block.key !== 'MEMORY' || spec.name !== 'start') return symbols;
      const free = clementinaMemoryMap(project?.memoryTop).filter(entry => entry.use === 'free');
      const starts: ConfigCompletion[] = free.map(entry => ({
        label: hex(entry.start, entry.start < 0x100 ? 2 : 4), kind: 'value', detail: entry.name, documentation: `${entry.name} (${range(entry.start, entry.end)}): ${entry.description}`,
        snippet: snippetHex(entry.start),
      }));
      if (project?.loadAddress !== undefined && !free.some(entry => entry.start === project.loadAddress)) {
        starts.unshift({label: hex(project.loadAddress), kind: 'value', detail: 'build.assembly.loadAddress', snippet: snippetHex(project.loadAddress)});
      }
      return [...starts, ...symbols];
    }
    default:
      return [];
  }
}

// --- Outline -----------------------------------------------------------------

export interface ConfigOutlineSymbol {
  name: string;
  kind: 'block' | 'memory' | 'segment' | 'symbol' | 'item';
  detail?: string;
  span: Span;
  endLine: number;
  children: ConfigOutlineSymbol[];
}

export function configOutline(config: ParsedConfig): ConfigOutlineSymbol[] {
  const areas = memoryAreas(config);
  const segments = segmentPlacements(config);
  return config.blocks.map(block => ({
    name: block.name, kind: 'block', span: block.span, endLine: block.closeLine,
    children: block.items.map(item => {
      const kind = block.key === 'MEMORY' ? 'memory' : block.key === 'SEGMENTS' ? 'segment' : block.key === 'SYMBOLS' ? 'symbol' : 'item';
      const area = areas.find(candidate => candidate.item === item);
      const segment = segments.find(candidate => candidate.item === item);
      const detail = area ? areaRange(area) : segment ? `${segment.load ?? '?'}, ${segment.type}` : undefined;
      return {name: item.name, kind, ...(detail ? {detail} : {}), span: item.span, endLine: item.endLine, children: []} as ConfigOutlineSymbol;
    }),
  }));
}
