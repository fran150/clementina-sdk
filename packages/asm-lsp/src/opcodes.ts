/**
 * The W65C02S instruction set (specs/machine.json names the CPU), as ca65
 * assembles it with `--cpu 65C02`: mnemonics, what each does, the flags it
 * changes, and every addressing mode with its opcode, length and cycle count.
 * A `+` after a cycle count means one more cycle when the access crosses a
 * page, and for a branch, one more when it is taken (and another for a page).
 */

export type AddressingMode =
  | 'implied' | 'accumulator' | 'immediate'
  | 'zeroPage' | 'zeroPageX' | 'zeroPageY'
  | 'absolute' | 'absoluteX' | 'absoluteY'
  | 'indirect' | 'indexedIndirect' | 'indirectIndexed' | 'zeroPageIndirect' | 'absoluteIndexedIndirect'
  | 'relative' | 'zeroPageRelative';

export interface AddressingModeInfo {
  mode: AddressingMode;
  opcode: number;
  bytes: number;
  cycles: string;
}

export interface Instruction {
  mnemonic: string;
  name: string;
  summary: string;
  /** Flags the instruction changes, in NV-BDIZC order, e.g. `N Z C`; empty when none. */
  flags: string;
  modes: AddressingModeInfo[];
}

/** How each addressing mode is written in ca65 source. */
export const addressingModeSyntax: Record<AddressingMode, {label: string; syntax: string}> = {
  implied: {label: 'Implied', syntax: ''},
  accumulator: {label: 'Accumulator', syntax: 'a'},
  immediate: {label: 'Immediate', syntax: '#value'},
  zeroPage: {label: 'Zero page', syntax: 'zp'},
  zeroPageX: {label: 'Zero page,X', syntax: 'zp,x'},
  zeroPageY: {label: 'Zero page,Y', syntax: 'zp,y'},
  absolute: {label: 'Absolute', syntax: 'addr'},
  absoluteX: {label: 'Absolute,X', syntax: 'addr,x'},
  absoluteY: {label: 'Absolute,Y', syntax: 'addr,y'},
  indirect: {label: 'Indirect', syntax: '(addr)'},
  indexedIndirect: {label: '(Zero page,X)', syntax: '(zp,x)'},
  indirectIndexed: {label: '(Zero page),Y', syntax: '(zp),y'},
  zeroPageIndirect: {label: '(Zero page)', syntax: '(zp)'},
  absoluteIndexedIndirect: {label: '(Absolute,X)', syntax: '(addr,x)'},
  relative: {label: 'Relative', syntax: 'label'},
  zeroPageRelative: {label: 'Zero page, relative', syntax: 'zp, label'},
};

type Row = [AddressingMode, number, number, string];

/** The eight modes of ADC, AND, CMP, EOR, LDA, ORA and SBC, with their opcode base. */
function aluModes(imm: number, zp: number, zpx: number, abs: number, absx: number, absy: number, indx: number, indy: number, zpind: number): Row[] {
  return [
    ['immediate', imm, 2, '2'], ['zeroPage', zp, 2, '3'], ['zeroPageX', zpx, 2, '4'],
    ['absolute', abs, 3, '4'], ['absoluteX', absx, 3, '4+'], ['absoluteY', absy, 3, '4+'],
    ['indexedIndirect', indx, 2, '6'], ['indirectIndexed', indy, 2, '5+'], ['zeroPageIndirect', zpind, 2, '5'],
  ];
}

/** Read-modify-write shifts and rotates: accumulator, zp, zp,x, abs, abs,x. */
function shiftModes(acc: number, zp: number, zpx: number, abs: number, absx: number): Row[] {
  return [['accumulator', acc, 1, '2'], ['zeroPage', zp, 2, '5'], ['zeroPageX', zpx, 2, '6'], ['absolute', abs, 3, '6'], ['absoluteX', absx, 3, '6+']];
}

const implied = (opcode: number, cycles = '2'): Row[] => [['implied', opcode, 1, cycles]];
const branch = (opcode: number): Row[] => [['relative', opcode, 2, '2+']];

const table: Array<[string, string, string, string, Row[]]> = [
  ['adc', 'Add with Carry', 'A = A + M + C. In decimal mode (D set) the add is BCD and takes one more cycle.', 'N V Z C', aluModes(0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71, 0x72)],
  ['and', 'AND with Accumulator', 'A = A AND M.', 'N Z', aluModes(0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31, 0x32)],
  ['asl', 'Arithmetic Shift Left', 'Shifts one bit left: bit 7 goes into C and bit 0 becomes 0.', 'N Z C', shiftModes(0x0a, 0x06, 0x16, 0x0e, 0x1e)],
  ['bcc', 'Branch if Carry Clear', 'Branches when C = 0, within -128..+127 bytes.', '', branch(0x90)],
  ['bcs', 'Branch if Carry Set', 'Branches when C = 1, within -128..+127 bytes.', '', branch(0xb0)],
  ['beq', 'Branch if Equal', 'Branches when Z = 1 (the last result was zero, or a compare was equal).', '', branch(0xf0)],
  ['bit', 'Bit Test', 'Sets Z from A AND M. Except in immediate mode, also copies bit 7 of M into N and bit 6 into V.', 'N V Z', [
    ['immediate', 0x89, 2, '2'], ['zeroPage', 0x24, 2, '3'], ['zeroPageX', 0x34, 2, '4'], ['absolute', 0x2c, 3, '4'], ['absoluteX', 0x3c, 3, '4+'],
  ]],
  ['bmi', 'Branch if Minus', 'Branches when N = 1.', '', branch(0x30)],
  ['bne', 'Branch if Not Equal', 'Branches when Z = 0.', '', branch(0xd0)],
  ['bpl', 'Branch if Plus', 'Branches when N = 0.', '', branch(0x10)],
  ['bra', 'Branch Always', 'Always branches, within -128..+127 bytes.', '', [['relative', 0x80, 2, '3+']]],
  ['brk', 'Break', 'Pushes PC + 2 and P (with B set), sets I, clears D and jumps through the IRQ/BRK vector at $FFFE. The return skips the byte after BRK, so a signature byte usually follows it.', 'B D I', [['implied', 0x00, 1, '7']]],
  ['bvc', 'Branch if Overflow Clear', 'Branches when V = 0.', '', branch(0x50)],
  ['bvs', 'Branch if Overflow Set', 'Branches when V = 1.', '', branch(0x70)],
  ['clc', 'Clear Carry', 'C = 0.', 'C', implied(0x18)],
  ['cld', 'Clear Decimal', 'D = 0: ADC and SBC work in binary.', 'D', implied(0xd8)],
  ['cli', 'Clear Interrupt Disable', 'I = 0: IRQs are taken.', 'I', implied(0x58)],
  ['clv', 'Clear Overflow', 'V = 0.', 'V', implied(0xb8)],
  ['cmp', 'Compare Accumulator', 'Sets the flags from A - M without changing A: C = 1 when A >= M, Z = 1 when A = M.', 'N Z C', aluModes(0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1, 0xd2)],
  ['cpx', 'Compare X', 'Sets the flags from X - M: C = 1 when X >= M, Z = 1 when X = M.', 'N Z C', [['immediate', 0xe0, 2, '2'], ['zeroPage', 0xe4, 2, '3'], ['absolute', 0xec, 3, '4']]],
  ['cpy', 'Compare Y', 'Sets the flags from Y - M: C = 1 when Y >= M, Z = 1 when Y = M.', 'N Z C', [['immediate', 0xc0, 2, '2'], ['zeroPage', 0xc4, 2, '3'], ['absolute', 0xcc, 3, '4']]],
  ['dec', 'Decrement', 'Subtracts one from memory, or from A (`dec a`).', 'N Z', [
    ['accumulator', 0x3a, 1, '2'], ['zeroPage', 0xc6, 2, '5'], ['zeroPageX', 0xd6, 2, '6'], ['absolute', 0xce, 3, '6'], ['absoluteX', 0xde, 3, '7'],
  ]],
  ['dex', 'Decrement X', 'X = X - 1.', 'N Z', implied(0xca)],
  ['dey', 'Decrement Y', 'Y = Y - 1.', 'N Z', implied(0x88)],
  ['eor', 'Exclusive OR', 'A = A XOR M.', 'N Z', aluModes(0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51, 0x52)],
  ['inc', 'Increment', 'Adds one to memory, or to A (`inc a`).', 'N Z', [
    ['accumulator', 0x1a, 1, '2'], ['zeroPage', 0xe6, 2, '5'], ['zeroPageX', 0xf6, 2, '6'], ['absolute', 0xee, 3, '6'], ['absoluteX', 0xfe, 3, '7'],
  ]],
  ['inx', 'Increment X', 'X = X + 1.', 'N Z', implied(0xe8)],
  ['iny', 'Increment Y', 'Y = Y + 1.', 'N Z', implied(0xc8)],
  ['jmp', 'Jump', 'Continues at the address. `jmp (addr)` reads the target from addr; `jmp (addr,x)` from addr + X, for jump tables.', '', [
    ['absolute', 0x4c, 3, '3'], ['indirect', 0x6c, 3, '6'], ['absoluteIndexedIndirect', 0x7c, 3, '6'],
  ]],
  ['jsr', 'Jump to Subroutine', 'Pushes the return address minus one and jumps; RTS comes back after the JSR.', '', [['absolute', 0x20, 3, '6']]],
  ['lda', 'Load Accumulator', 'A = M.', 'N Z', aluModes(0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1, 0xb2)],
  ['ldx', 'Load X', 'X = M.', 'N Z', [['immediate', 0xa2, 2, '2'], ['zeroPage', 0xa6, 2, '3'], ['zeroPageY', 0xb6, 2, '4'], ['absolute', 0xae, 3, '4'], ['absoluteY', 0xbe, 3, '4+']]],
  ['ldy', 'Load Y', 'Y = M.', 'N Z', [['immediate', 0xa0, 2, '2'], ['zeroPage', 0xa4, 2, '3'], ['zeroPageX', 0xb4, 2, '4'], ['absolute', 0xac, 3, '4'], ['absoluteX', 0xbc, 3, '4+']]],
  ['lsr', 'Logical Shift Right', 'Shifts one bit right: bit 0 goes into C and bit 7 becomes 0 (so N = 0).', 'N Z C', shiftModes(0x4a, 0x46, 0x56, 0x4e, 0x5e)],
  ['nop', 'No Operation', 'Does nothing for two cycles.', '', implied(0xea)],
  ['ora', 'OR with Accumulator', 'A = A OR M.', 'N Z', aluModes(0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11, 0x12)],
  ['pha', 'Push Accumulator', 'Pushes A on the stack.', '', implied(0x48, '3')],
  ['php', 'Push Processor Status', 'Pushes P on the stack, with B set.', '', implied(0x08, '3')],
  ['phx', 'Push X', 'Pushes X on the stack.', '', implied(0xda, '3')],
  ['phy', 'Push Y', 'Pushes Y on the stack.', '', implied(0x5a, '3')],
  ['pla', 'Pull Accumulator', 'Pulls A from the stack.', 'N Z', implied(0x68, '4')],
  ['plp', 'Pull Processor Status', 'Pulls P from the stack.', 'N V D I Z C', implied(0x28, '4')],
  ['plx', 'Pull X', 'Pulls X from the stack.', 'N Z', implied(0xfa, '4')],
  ['ply', 'Pull Y', 'Pulls Y from the stack.', 'N Z', implied(0x7a, '4')],
  ['rol', 'Rotate Left', 'Rotates one bit left through C: C goes into bit 0 and bit 7 into C.', 'N Z C', shiftModes(0x2a, 0x26, 0x36, 0x2e, 0x3e)],
  ['ror', 'Rotate Right', 'Rotates one bit right through C: C goes into bit 7 and bit 0 into C.', 'N Z C', shiftModes(0x6a, 0x66, 0x76, 0x6e, 0x7e)],
  ['rti', 'Return from Interrupt', 'Pulls P, then PC, from the stack.', 'N V D I Z C', implied(0x40, '6')],
  ['rts', 'Return from Subroutine', 'Pulls the return address from the stack and continues after the JSR.', '', implied(0x60, '6')],
  ['sbc', 'Subtract with Carry', 'A = A - M - (1 - C): set C before a subtract. In decimal mode the subtract is BCD and takes one more cycle.', 'N V Z C', aluModes(0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1, 0xf2)],
  ['sec', 'Set Carry', 'C = 1.', 'C', implied(0x38)],
  ['sed', 'Set Decimal', 'D = 1: ADC and SBC work in BCD.', 'D', implied(0xf8)],
  ['sei', 'Set Interrupt Disable', 'I = 1: IRQs wait.', 'I', implied(0x78)],
  ['sta', 'Store Accumulator', 'M = A.', '', [
    ['zeroPage', 0x85, 2, '3'], ['zeroPageX', 0x95, 2, '4'], ['absolute', 0x8d, 3, '4'], ['absoluteX', 0x9d, 3, '5'], ['absoluteY', 0x99, 3, '5'],
    ['indexedIndirect', 0x81, 2, '6'], ['indirectIndexed', 0x91, 2, '6'], ['zeroPageIndirect', 0x92, 2, '5'],
  ]],
  ['stp', 'Stop', 'Stops the clock until a reset.', '', implied(0xdb, '3')],
  ['stx', 'Store X', 'M = X.', '', [['zeroPage', 0x86, 2, '3'], ['zeroPageY', 0x96, 2, '4'], ['absolute', 0x8e, 3, '4']]],
  ['sty', 'Store Y', 'M = Y.', '', [['zeroPage', 0x84, 2, '3'], ['zeroPageX', 0x94, 2, '4'], ['absolute', 0x8c, 3, '4']]],
  ['stz', 'Store Zero', 'M = 0.', '', [['zeroPage', 0x64, 2, '3'], ['zeroPageX', 0x74, 2, '4'], ['absolute', 0x9c, 3, '4'], ['absoluteX', 0x9e, 3, '5']]],
  ['tax', 'Transfer A to X', 'X = A.', 'N Z', implied(0xaa)],
  ['tay', 'Transfer A to Y', 'Y = A.', 'N Z', implied(0xa8)],
  ['trb', 'Test and Reset Bits', 'Sets Z from A AND M, then clears in M the bits set in A.', 'Z', [['zeroPage', 0x14, 2, '5'], ['absolute', 0x1c, 3, '6']]],
  ['tsb', 'Test and Set Bits', 'Sets Z from A AND M, then sets in M the bits set in A.', 'Z', [['zeroPage', 0x04, 2, '5'], ['absolute', 0x0c, 3, '6']]],
  ['tsx', 'Transfer Stack Pointer to X', 'X = S.', 'N Z', implied(0xba)],
  ['txa', 'Transfer X to A', 'A = X.', 'N Z', implied(0x8a)],
  ['txs', 'Transfer X to Stack Pointer', 'S = X.', '', implied(0x9a)],
  ['tya', 'Transfer Y to A', 'A = Y.', 'N Z', implied(0x98)],
  ['wai', 'Wait for Interrupt', 'Waits, with the clock running, until an IRQ or NMI. With I set, an IRQ wakes it without being taken.', '', implied(0xcb, '3')],
];

for (let bit = 0; bit < 8; bit += 1) {
  table.push(
    [`bbr${bit}`, `Branch on Bit ${bit} Reset`, `Branches when bit ${bit} of the zero-page byte is 0: \`bbr${bit} zp, label\`.`, '', [['zeroPageRelative', 0x0f + bit * 0x10, 3, '5+']]],
    [`bbs${bit}`, `Branch on Bit ${bit} Set`, `Branches when bit ${bit} of the zero-page byte is 1: \`bbs${bit} zp, label\`.`, '', [['zeroPageRelative', 0x8f + bit * 0x10, 3, '5+']]],
    [`rmb${bit}`, `Reset Memory Bit ${bit}`, `Clears bit ${bit} of the zero-page byte.`, '', [['zeroPage', 0x07 + bit * 0x10, 2, '5']]],
    [`smb${bit}`, `Set Memory Bit ${bit}`, `Sets bit ${bit} of the zero-page byte.`, '', [['zeroPage', 0x87 + bit * 0x10, 2, '5']]],
  );
}

/** Every W65C02S instruction, keyed by lowercase mnemonic. */
export const instructions: ReadonlyMap<string, Instruction> = new Map(table
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([mnemonic, name, summary, flags, rows]) => [mnemonic, {
    mnemonic, name, summary, flags,
    modes: rows.map(([mode, opcode, bytes, cycles]) => ({mode, opcode, bytes, cycles})),
  }]));

/** The instruction for a mnemonic in any case, or undefined. */
export function instructionFor(mnemonic: string): Instruction | undefined {
  return instructions.get(mnemonic.toLowerCase());
}
