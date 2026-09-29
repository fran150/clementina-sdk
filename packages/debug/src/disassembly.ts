import {opcodes, type AddressMode} from './opcodes.js';

export interface DecodedInstruction {
  address: number;
  bytes: number[];
  text: string;
}

/** Format an unsigned operand as uppercase hexadecimal. */
const hex = (value: number, width: number): string => `$${value.toString(16).toUpperCase().padStart(width, '0')}`;
const sizes: Record<AddressMode, number> = {
  imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, abs: 3, absx: 3, absy: 3,
  rel: 2, ind: 3, zpi: 2, zpxi: 2, zpiy: 2, absxi: 3, brk: 2, zprel: 3,
};

/** Format one operand using its W65C02S addressing mode. */
function formatOperand(mode: AddressMode, address: number, data: readonly number[]): string {
  const byte = data[1]!;
  const word = byte | ((data[2] ?? 0) << 8);
  switch (mode) {
    case 'imp': case 'brk': return '';
    case 'acc': return ' A';
    case 'imm': return ` #${hex(byte, 2)}`;
    case 'zp': return ` ${hex(byte, 2)}`;
    case 'zpx': return ` ${hex(byte, 2)},X`;
    case 'zpy': return ` ${hex(byte, 2)},Y`;
    case 'abs': return ` ${hex(word, 4)}`;
    case 'absx': return ` ${hex(word, 4)},X`;
    case 'absy': return ` ${hex(word, 4)},Y`;
    case 'rel': return ` ${hex((address + 2 + (byte < 128 ? byte : byte - 256)) & 0xffff, 4)}`;
    case 'ind': return ` (${hex(word, 4)})`;
    case 'zpi': return ` (${hex(byte, 2)})`;
    case 'zpxi': return ` (${hex(byte, 2)},X)`;
    case 'zpiy': return ` (${hex(byte, 2)}),Y`;
    case 'absxi': return ` (${hex(word, 4)},X)`;
    case 'zprel': {
      const displacement = data[2]!;
      return ` ${hex(byte, 2)},${hex((address + 3 + (displacement < 128 ? displacement : displacement - 256)) & 0xffff, 4)}`;
    }
  }
}

/** Decode the emulator's supported W65C02S opcodes from a bounded, captured byte range. */
export function decodeInstructions(address: number, bytes: readonly (number | null)[], count: number): DecodedInstruction[] {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff || !Number.isInteger(count) || count < 1 || count > 64) {
    throw new RangeError('Invalid disassembly range');
  }
  const result: DecodedInstruction[] = [];
  let offset = 0;
  while (result.length < count && offset < bytes.length && address + offset <= 0xffff) {
    const start = address + offset, opcode = bytes[offset];
    if (opcode === null || opcode === undefined) break;
    const definition = opcodes[opcode];
    const size = definition ? sizes[definition[1]] : 1;
    const instructionBytes = bytes.slice(offset, offset + size);
    if (instructionBytes.length < size || instructionBytes.some(byte => byte === null)) break;
    const data = instructionBytes as number[];
    const text = definition
      ? definition[0] + formatOperand(definition[1], start, data)
      : `.byte ${hex(opcode, 2)}`;
    result.push({address: start, bytes: data, text});
    offset += size;
  }
  return result;
}
