import type {EmulatorClient} from '@clementina/emulator-client';

/** A decoded simple variable in the ROM BASIC variable table. */
export interface BasicRuntimeVariable {
  name: string;
  value: string;
  type: 'number' | 'integer' | 'string' | 'array';
}

/** Read the ROM's simple-variable table and return variables sorted by name. */
export async function readBasicVariables(client: EmulatorClient): Promise<BasicRuntimeVariable[]> {
  const pointers = await readBytes(client, 0x007c, 4);
  const vartab = pointers[0]! | (pointers[1]! << 8);
  const arytab = pointers[2]! | (pointers[3]! << 8);
  if (arytab < vartab || (arytab - vartab) % 7 !== 0) throw new Error('Invalid BASIC variable table bounds');

  const variables: BasicRuntimeVariable[] = [];
  for (let address = vartab; address < arytab; address += 7) {
    const record = await readBytes(client, address, 7);
    const name = variableName(record[0]!, record[1]!);
    const string = (record[1]! & 0x80) !== 0;
    const integer = !string && (record[0]! & 0x80) !== 0;
    if (string) {
      const length = record[2]!;
      const pointer = record[3]! | (record[4]! << 8);
      const value = length === 0 ? '' : String.fromCharCode(...await readBytes(client, pointer, length));
      variables.push({name, value: JSON.stringify(value), type: 'string'});
    } else if (integer) {
      const unsigned = (record[2]! << 8) | record[3]!;
      variables.push({name, value: String(unsigned & 0x8000 ? unsigned - 0x10000 : unsigned), type: 'integer'});
    } else {
      variables.push({name, value: String(decodeFloat(record.slice(2, 7))), type: 'number'});
    }
  }
  return variables.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read only fully available CPU bytes for BASIC metadata and variable values. */
async function readBytes(client: EmulatorClient, address: number, count: number): Promise<number[]> {
  const bytes = await client.readMemory(address, count);
  if (bytes.some(byte => byte === null)) throw new Error(`BASIC memory at $${address.toString(16).toUpperCase()} is not readable`);
  return bytes as number[];
}

/** Decode BASIC's two significant name characters and optional type suffix. */
function variableName(first: number, second: number): string {
  let name = String.fromCharCode(first & 0x7f);
  if ((second & 0x7f) !== 0) name += String.fromCharCode(second & 0x7f);
  if (second & 0x80) name += '$';
  else if (first & 0x80) name += '%';
  return name;
}

/** Decode the ROM's five-byte floating-point representation. */
function decodeFloat(bytes: number[]): number {
  const exponent = bytes[0]!;
  if (exponent === 0) return 0;
  const negative = (bytes[1]! & 0x80) !== 0;
  const fraction = (((bytes[1]! & 0x7f) * 0x1000000) + (bytes[2]! * 0x10000) + (bytes[3]! * 0x100) + bytes[4]!) / 0x80000000;
  const value = (1 + fraction) * 2 ** (exponent - 129);
  return negative ? -value : value;
}
