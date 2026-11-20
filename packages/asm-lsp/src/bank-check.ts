/**
 * The bank-switch check: a store to VIA Port A (VIA_ORA, which picks the
 * extended RAM bank at $8000-$BFFF) from code linked in that window maps
 * another bank under the code that is running, so the next instruction comes
 * from the new bank. The linker configuration says which segments are linked
 * there; build.assembly.banks or an area's `bank` attribute says which bank.
 */
import {configEvaluator, type ParsedConfig} from './ld65-config.js';
import {evaluate} from './expression.js';
import type {ParsedFile, Span, Statement} from './parser.js';
import type {AsmWorkspace} from './workspace.js';

/** A segment linked in $8000-$BFFF. */
export interface BankedSegment {
  /** The MEMORY area it runs in. */
  memory: string;
  /** Its bank, when the manifest or the area's `bank` attribute says. */
  bank?: number;
}

export interface BankWarning {
  span: Span;
  message: string;
}

const WINDOW_START = 0x8000, WINDOW_END = 0xbfff;

/**
 * Whether an address is VIA Port A: VIA_ORA ($C001) or VIA_ORA_NH ($C00F),
 * or one of their mirrors. The VIA fills $C000-$C3FF and repeats every 16
 * bytes (specs/cpu-memory-map.json `via`).
 */
export function isBankSelect(address: number): boolean {
  return address >= 0xc000 && address <= 0xc3ff && ((address & 0xf) === 0x1 || (address & 0xf) === 0xf);
}

/**
 * The segments a linker configuration runs in $8000-$BFFF, by name.
 *
 * @param config - The parsed linker configuration.
 * @param banks - build.assembly.banks: the bank of each MEMORY area it lists.
 */
export function bankedSegments(config: ParsedConfig, banks: ReadonlyArray<{bank: number; memory: string}> = []): Map<string, BankedSegment> {
  const evaluate = configEvaluator(config);
  const areas = new Map<string, BankedSegment>();
  for (const block of config.blocks) {
    if (block.key !== 'MEMORY') continue;
    for (const item of block.items) {
      const value = (key: string) => {
        const attribute = item.attributes.find(entry => entry.key === key)?.value;
        return attribute ? evaluate(attribute.tokens).value : undefined;
      };
      const start = value('start');
      if (start === undefined || start < WINDOW_START || start > WINDOW_END) continue;
      const bank = banks.find(entry => entry.memory === item.name)?.bank ?? value('bank');
      areas.set(item.name, {memory: item.name, ...(bank === undefined ? {} : {bank})});
    }
  }
  const segments = new Map<string, BankedSegment>();
  for (const block of config.blocks) {
    if (block.key !== 'SEGMENTS') continue;
    for (const item of block.items) {
      // Code runs where `run` puts it, or where it loads.
      const attribute = item.attributes.find(entry => entry.key === 'run') ?? item.attributes.find(entry => entry.key === 'load');
      const area = attribute?.value?.text && areas.get(attribute.value.text);
      if (area) segments.set(item.name, area);
    }
  }
  return segments;
}

const STORES: Record<string, string> = {sta: 'lda', stx: 'ldx', sty: 'ldy', stz: ''};

/** The segment active on each line: `.segment` and the `.code`/`.rodata`/... shortcuts; CODE before any. */
function segmentAt(file: ParsedFile, line: number): string {
  let name = 'CODE';
  for (const segment of file.segments) {
    if (segment.line > line) break;
    name = segment.name;
  }
  return name;
}

/** The operand of an absolute, unindexed store: `VIA_ORA`, `$C001`, `a:VIA_ORA`. */
function absoluteOperand(statement: Statement): string | undefined {
  const text = statement.operand?.text.trim() ?? '';
  if (!text || text.startsWith('#') || text.startsWith('(') || text.includes(',')) return undefined;
  return text.replace(/^a:/iu, '');
}

/**
 * Warn about each store to VIA Port A in a segment linked in $8000-$BFFF,
 * except one that follows a plain `lda #n` (or `ldx`/`ldy`) of the code's own
 * bank, which maps the same bank again.
 *
 * @param file - The parsed source file.
 * @param segments - Banked segments from {@link bankedSegments}.
 * @param valueAt - The value of an expression written on a line, when constant.
 * @param storesBank - Whether a macro called on a line stores to VIA Port A.
 */
export function bankSwitchWarnings(
  file: ParsedFile,
  segments: ReadonlyMap<string, BankedSegment>,
  valueAt: (text: string, line: number) => number | undefined,
  storesBank: (name: string, line: number) => boolean = () => false,
): BankWarning[] {
  if (segments.size === 0) return [];
  const warnings: BankWarning[] = [];
  const labelled = new Set([...file.symbols.filter(symbol => symbol.kind === 'label' || symbol.kind === 'local').map(symbol => symbol.span.line), ...file.unnamedLabels]);
  const statements = file.statements.filter(statement => statement.word && !statement.inMacro);
  statements.forEach((statement, index) => {
    const segment = segments.get(segmentAt(file, statement.line));
    if (!segment) return;
    const word = statement.word!;
    const mnemonic = word.text.toLowerCase();
    const where = segment.bank === undefined
      ? `MEMORY area ${segment.memory}, at $8000-$BFFF`
      : `bank ${segment.bank} (MEMORY area ${segment.memory})`;
    const advice = 'so the next instruction is read from the new bank. Switch banks from code below $8000, such as a far-call routine there.';
    if (mnemonic in STORES) {
      const operand = absoluteOperand(statement);
      const address = operand === undefined ? undefined : valueAt(operand, statement.line);
      if (address === undefined || !isBankSelect(address)) return;
      // `lda #1` then `sta VIA_ORA` in bank 1 maps bank 1 again: harmless.
      const previous = statements[index - 1];
      const load = STORES[mnemonic];
      if (load && segment.bank !== undefined && previous && previous.word!.text.toLowerCase() === load
        && !labelled.has(statement.line) && previous.operand?.text.trim().startsWith('#')
        && valueAt(previous.operand.text.trim().slice(1), previous.line) === segment.bank) return;
      warnings.push({
        span: {line: statement.line, start: word.start, end: statement.operand!.start + statement.operand!.text.trimEnd().length},
        message: `This store to VIA Port A switches the bank under code that runs in ${where}, ${advice}`,
      });
    } else if (storesBank(word.text, statement.line)) {
      warnings.push({
        span: {line: statement.line, start: word.start, end: word.end},
        message: `Macro ${word.text} stores to VIA Port A, which switches the bank under code that runs in ${where}, ${advice}`,
      });
    }
  });
  return warnings;
}

/** The value of an expression written on a line of a file, when it is constant. */
function valueOnLine(workspace: AsmWorkspace, path: string, text: string, line: number): number | undefined {
  const statement = workspace.get(path)?.parsed.statements.find(item => item.line === line);
  return evaluate(text, name => {
    const target = workspace.resolve(path, {name, scope: statement?.scope ?? '', cheapScope: statement?.cheapScope ?? 0});
    return target ? workspace.valueOf(target) : undefined;
  });
}

/** Whether the macro a line calls stores a constant VIA Port A address. */
function macroStoresBank(workspace: AsmWorkspace, path: string, name: string, line: number): boolean {
  const statement = workspace.get(path)?.parsed.statements.find(item => item.line === line);
  const target = workspace.resolve(path, {name, scope: statement?.scope ?? '', cheapScope: statement?.cheapScope ?? 0});
  if (target?.symbol.kind !== 'macro' || target.symbol.endLine === undefined) return false;
  const body = workspace.get(target.path)?.parsed.statements
    .filter(item => item.inMacro && item.line > target.symbol.span.line && item.line < target.symbol.endLine!) ?? [];
  return body.some(item => {
    const operand = item.operand?.text.trim() ?? '';
    if (!['sta', 'stx', 'sty', 'stz'].includes(item.word?.text.toLowerCase() ?? '') || !operand || /^[#(]|,/u.test(operand)) return false;
    const address = valueOnLine(workspace, target.path, operand.replace(/^a:/iu, ''), item.line);
    return address !== undefined && isBankSelect(address);
  });
}

/**
 * The bank-switch warnings for one file of a workspace, resolving names
 * through its includes and modules.
 *
 * @param workspace - The parsed files.
 * @param path - The file to check.
 * @param segments - Banked segments from {@link bankedSegments}.
 */
export function workspaceBankWarnings(workspace: AsmWorkspace, path: string, segments: ReadonlyMap<string, BankedSegment>): BankWarning[] {
  const file = workspace.get(path);
  if (!file) return [];
  return bankSwitchWarnings(file.parsed, segments, (text, line) => valueOnLine(workspace, path, text, line), (name, line) => macroStoresBank(workspace, path, name, line));
}
