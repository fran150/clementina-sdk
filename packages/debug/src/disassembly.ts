import {opcodes, type AddressMode} from './opcodes.js';

export interface DecodedInstruction {
  address: number;
  bytes: number[];
  text: string;
}

const hex = (value: number, width: number): string => `$${value.toString(16).toUpperCase().padStart(width, '0')}`;
const sizes: Record<AddressMode, number> = {
  imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, abs: 3, absx: 3, absy: 3,
  rel: 2, ind: 3, zpi: 2, zpxi: 2, zpiy: 2, absxi: 3, brk: 2, zprel: 3,
};

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
    const word = data.length > 2 ? data[1] | (data[2] << 8) : 0;
    let text: string;
    if (!definition) text = `.byte ${hex(opcode, 2)}`;
    else {
      const [mnemonic, mode] = definition;
      const operand: Record<AddressMode, string> = {
        imp: '', acc: ' A', imm: ` #${hex(data[1], 2)}`, zp: ` ${hex(data[1], 2)}`,
        zpx: ` ${hex(data[1], 2)},X`, zpy: ` ${hex(data[1], 2)},Y`, abs: ` ${hex(word, 4)}`,
        absx: ` ${hex(word, 4)},X`, absy: ` ${hex(word, 4)},Y`,
        rel: ` ${hex((start + 2 + (data[1] < 128 ? data[1] : data[1] - 256)) & 0xffff, 4)}`,
        ind: ` (${hex(word, 4)})`, zpi: ` (${hex(data[1], 2)})`,
        zpxi: ` (${hex(data[1], 2)},X)`, zpiy: ` (${hex(data[1], 2)}),Y`,
        absxi: ` (${hex(word, 4)},X)`, brk: '',
        zprel: ` ${hex(data[1], 2)},${hex((start + 3 + (data[2] < 128 ? data[2] : data[2] - 256)) & 0xffff, 4)}`,
      };
      text = mnemonic + operand[mode];
    }
    result.push({address: start, bytes: data, text});
    offset += size;
  }
  return result;
}
