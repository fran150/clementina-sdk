import {assertValid} from '@clementina/core';
import {checkLoadPlan, type PrgLoadStep} from './load-plan.js';

export interface PrgInfo {
  loadAddress: number;
  headerLength: 2;
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

/**
 * Pack bytes in the 2-byte-header PRG format consumed by KERN_LOAD. The file
 * doesn't record a bank; `bank`, the one BANK picks before loading it, only
 * bounds how long the payload may be.
 */
export function encodePrg(payload: Uint8Array, loadAddress: number, bank?: number): Uint8Array {
  if (!(payload instanceof Uint8Array) || payload.length === 0) throw new TypeError('PRG payload must be a non-empty Uint8Array');
  checkPrgShape(loadAddress, bank, payload.length);
  const output = new Uint8Array(2 + payload.length);
  output[0] = loadAddress & 0xff;
  output[1] = loadAddress >>> 8;
  output.set(payload, 2);
  return output;
}

/** Inspect and validate a PRG header and payload bounds without copying it. */
export function inspectPrg(file: Uint8Array): PrgInfo {
  if (!(file instanceof Uint8Array) || file.length < 3) throw new TypeError('PRG must contain a header and non-empty payload');
  const loadAddress = file[0] | (file[1] << 8);
  checkPrgShape(loadAddress, undefined, file.length - 2);
  return {loadAddress, headerLength: 2, payloadLength: file.length - 2};
}
