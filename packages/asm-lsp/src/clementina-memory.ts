/**
 * The Clementina CPU memory map as a linker configuration sees it: what each
 * address range is used for, and whether a program's memory area may take it.
 * The fixed addresses follow specs/cpu-memory-map.json (tests check them);
 * the top of BASIC's heap comes from the project's `build.basic.memoryTop`.
 */

export type MemoryUse =
  /** Free for programs. */
  | 'free'
  /** BASIC's: a program that returns to BASIC must leave it alone. */
  | 'basic'
  /** The machine's: kernel, stack, system variables. */
  | 'system'
  /** WozMon's, only while it runs. */
  | 'wozmon'
  /** Not RAM: I/O slots or MIA's registers. */
  | 'device';

export interface MemoryMapEntry {
  name: string;
  start: number;
  /** One past the last byte. */
  end: number;
  use: MemoryUse;
  description: string;
}

/** specs/cpu-memory-map.json image.heapEndExclusive: MEMSIZ when memoryTop is not set. */
export const DEFAULT_MEMORY_TOP = 0xc000;
/** specs/cpu-memory-map.json image.kernelRegionEndExclusive: where BASIC's interpreter starts. */
export const BASIC_START = 0x1600;

export const hex = (value: number, digits = 4) => `$${value.toString(16).toUpperCase().padStart(digits, '0')}`;
export const range = (start: number, end: number) => (end - start <= 1 ? hex(start, start < 0x100 ? 2 : 4) : `${hex(start, start < 0x100 && end <= 0x100 ? 2 : 4)}-${hex(end - 1, start < 0x100 && end <= 0x100 ? 2 : 4)}`);

/** The CPU address space from $0000 to $FFFF, in order, for a BASIC MEMSIZ of `memoryTop`. */
export function clementinaMemoryMap(memoryTop = DEFAULT_MEMORY_TOP): MemoryMapEntry[] {
  const top = Math.min(Math.max(memoryTop, BASIC_START), DEFAULT_MEMORY_TOP);
  const entries: MemoryMapEntry[] = [
    {name: 'BASIC zero page', start: 0x00, end: 0x98, use: 'basic', description: 'BASIC\'s variables and its CHRGET routine. A program that replaces BASIC may use them.'},
    {name: 'Program zero page', start: 0x98, end: 0xe0, use: 'free', description: 'Free for programs (72 bytes). BASIC, WozMon and the kernel never touch them.'},
    {name: 'System spare zero page', start: 0xe0, end: 0xe8, use: 'system', description: 'Kept for the system, which may hand it to programs later.'},
    {name: 'WozMon zero page', start: 0xe8, end: 0xf0, use: 'wozmon', description: 'WozMon\'s variables, used only while WozMon runs (MON).'},
    {name: 'Kernel zero page', start: 0xf0, end: 0x100, use: 'system', description: 'Kernel variables: the IRQ updates KJIFFY, and KERN_LOAD takes its parameters in KPTR/KTMP.'},
    {name: 'Stack', start: 0x100, end: 0x200, use: 'system', description: 'The 6502 stack; BASIC stages a line\'s link and number at $01FC-$01FF.'},
    {name: 'Line input buffer', start: 0x200, end: 0x280, use: 'basic', description: 'The line input buffer BASIC and WozMon share.'},
    {name: 'Program page', start: 0x280, end: 0x2f8, use: 'free', description: 'Free for programs (120 bytes). Nothing in the system writes here.'},
    {name: 'Clock snapshot', start: 0x2f8, end: 0x300, use: 'system', description: 'KERN_RDTIM\'s copy of MIA\'s clock; BASIC\'s TI, TICKS and DELAY write it too.'},
    {name: 'Kernel variables', start: 0x300, end: 0x400, use: 'system', description: 'Kernel, screen editor and BASIC variables (KVARS).'},
    {name: 'Kernel image', start: 0x400, end: BASIC_START, use: 'system', description: 'The kernel jump table, DIR_NAME_BUF, the kernel and WozMon. BLOAD and BRUN run from here.'},
    {name: 'BASIC', start: BASIC_START, end: top, use: 'basic', description: `BASIC's interpreter, then the program, its variables and strings up to MEMSIZ (${hex(top)}). Where the interpreter ends moves with each ROM build.`},
  ];
  if (top < 0x8000) entries.push({name: 'Free RAM', start: top, end: 0x8000, use: 'free', description: 'Base RAM above BASIC\'s MEMSIZ, free for programs.'});
  const windowStart = Math.max(top, 0x8000);
  if (windowStart < 0xc000) {
    entries.push({name: 'Extended RAM window', start: windowStart, end: 0xc000, use: 'free',
      description: 'A 16 KiB window into 512 KiB of banked RAM: VIA Port A (PA0-PA4) selects one of 32 banks. Bank 0 is selected while BASIC runs.'});
  }
  entries.push(
    {name: 'I/O', start: 0xc000, end: 0xe000, use: 'device', description: 'Eight 1 KiB device slots: slot 0 ($C000-$C3FF) is the 65C22 VIA, the rest are free for expansion cards. Not RAM.'},
    {name: 'MIA', start: 0xe000, end: 0x10000, use: 'device', description: 'MIA: its 32 registers at $FFE0-$FFFF, repeated every 32 bytes below. Not RAM.'},
  );
  return entries;
}

/** The entries an address range touches. */
export function memoryAt(start: number, end: number, memoryTop?: number): MemoryMapEntry[] {
  return clementinaMemoryMap(memoryTop).filter(entry => start < entry.end && entry.start < end);
}
