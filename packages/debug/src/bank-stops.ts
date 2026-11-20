import type {AssemblyBuildResult} from '@clementina/assembler';
import type {BankBreakpoint} from '@clementina/emulator-client';

/** STA, STX, STY and STZ with an absolute address: the stores that can select a bank. */
const ABSOLUTE_STORES = new Set([0x8d, 0x8e, 0x8c, 0x9c]);

/** VIA_ORA ($C001), VIA_ORA_NH ($C00F) and their mirrors every 16 bytes up to $C3FF (specs/cpu-memory-map.json `via`). */
const isBankSelect = (address: number) => address >= 0xc000 && address <= 0xc3ff && ((address & 0xf) === 0x1 || (address & 0xf) === 0xf);

/**
 * Find each instruction in code linked at $8000-$BFFF that stores to VIA
 * Port A, which maps another bank under the running code. The debugger puts a
 * bank breakpoint on each, so a session can stop just before the bank changes.
 *
 * @param assembly - A built assembly: the main image, its banks and debug data.
 * @returns The address and bank of each such instruction, in address order.
 */
export function bankSwitchStops(assembly: AssemblyBuildResult): BankBreakpoint[] {
  const segments = new Map(assembly.debug.segments.map(segment => [segment.id, segment]));
  const mainBank = assembly.loadStep.bank;
  const images = new Map(assembly.banks.flatMap(bank => bank.segments.map(name => [name, bank] as const)));
  const stops = new Map<string, BankBreakpoint>();
  for (const line of assembly.debug.lines) {
    for (const spanId of line.spanIds) {
      const span = assembly.debug.spans.find(item => item.id === spanId);
      const segment = span && segments.get(span.segmentId);
      if (!span || !segment || span.size !== 3 || segment.outputOffset === undefined) continue;
      const address = segment.start + span.start;
      if (address < 0x8000 || address > 0xbfff) continue;
      const image = images.get(segment.name);
      const bank = image?.bank ?? mainBank;
      if (bank === undefined) continue;
      const bytes = image?.binary ?? assembly.binary;
      const offset = segment.outputOffset + span.start;
      if (offset + 3 > bytes.length || !ABSOLUTE_STORES.has(bytes[offset]!)) continue;
      if (!isBankSelect(bytes[offset + 1]! | (bytes[offset + 2]! << 8))) continue;
      stops.set(`${bank}:${address}`, {address, bank});
    }
  }
  return [...stops.values()].sort((a, b) => a.bank - b.bank || a.address - b.address);
}
