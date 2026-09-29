import {assertValid} from '@clementina/core';
import {checkLoadPlan, type PrgLoadStep} from './load-plan.js';

export interface PrgInfo {
  loadAddress: number;
  bank?: number;
  headerLength: 2 | 3;
  payloadLength: number;
}

/** Reuse load-plan validation for a terminal PRG's address, bank, and size. */
function checkPrgShape(loadAddress: number, bank: number | undefined, payloadLength: number): void {
  const step: PrgLoadStep = {
    kind: 'prg', path: 'IMAGE.PRG', loadAddress, length: payloadLength,
    ...(bank === undefined ? {} : {bank}), runAddress: 1,
  };
  assertValid(checkLoadPlan({format: 'clementina-load-plan', version: 1, steps: [step]}));
}

/** Pack bytes in the exact two- or three-byte PRG format consumed by KERN_LOAD. */
export function encodePrg(payload: Uint8Array, loadAddress: number, bank?: number): Uint8Array {
  if (!(payload instanceof Uint8Array) || payload.length === 0) throw new TypeError('PRG payload must be a non-empty Uint8Array');
  checkPrgShape(loadAddress, bank, payload.length);
  const headerLength = bank === undefined ? 2 : 3;
  const output = new Uint8Array(headerLength + payload.length);
  output[0] = loadAddress & 0xff;
  output[1] = loadAddress >>> 8;
  if (bank !== undefined) output[2] = bank;
  output.set(payload, headerLength);
  return output;
}

/** Inspect and validate a PRG header and payload bounds without copying it. */
export function inspectPrg(file: Uint8Array): PrgInfo {
  if (!(file instanceof Uint8Array) || file.length < 3) throw new TypeError('PRG must contain a header and non-empty payload');
  const loadAddress = file[0] | (file[1] << 8);
  const banked = loadAddress >= 0x8000 && loadAddress < 0xc000;
  const headerLength: 2 | 3 = banked ? 3 : 2;
  if (file.length <= headerLength) throw new TypeError('PRG payload must not be empty');
  const bank = banked ? file[2] : undefined;
  checkPrgShape(loadAddress, bank, file.length - headerLength);
  return {loadAddress, ...(bank === undefined ? {} : {bank}), headerLength, payloadLength: file.length - headerLength};
}
