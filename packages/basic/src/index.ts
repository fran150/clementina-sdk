import {
  assertValid,
  diagnostic,
  result,
  schemaDiagnostics,
  type ClementinaDiagnostic,
  type ValidationResult,
} from '@clementina/core';

export const knownLoadIssue = 'audio-sequencer-sd-memory-overlap' as const;
export type KnownLoadIssue = typeof knownLoadIssue;

export interface MiaLoadStep {
  kind: 'mia';
  path: string;
  address: number;
  /** Exact generated file length, used for bounds checks. */
  length: number;
}

export interface PrgLoadStep {
  kind: 'prg';
  path: string;
  loadAddress: number;
  /** Payload length, excluding the two- or three-byte PRG header. */
  length: number;
  /** Required for load addresses $8000-$BFFF; forbidden below $8000. */
  bank?: number;
  /** A nonzero value makes this the terminal takeover step. */
  runAddress?: number;
}

export type LoadStep = MiaLoadStep | PrgLoadStep;
export interface LoadPlan {
  format: 'clementina-load-plan';
  version: 1;
  acknowledgedIssues?: KnownLoadIssue[];
  steps: LoadStep[];
}

export interface PrgInfo {
  loadAddress: number;
  bank?: number;
  headerLength: 2 | 3;
  payloadLength: number;
}

const MIA_SIZE = 0x40000;
const OVERLAP_START = 0x13000;
const OVERLAP_END = 0x14000;
const KERNEL_BASE = 0x04b7;
const BASIC_LINE_LIMIT = 71;

function portablePath(path: string): boolean {
  return path.length > 0 && path.length <= 255 && !path.startsWith('/') && !path.includes('\\')
    && !path.includes('"') && !/[\u0000-\u001f\u007f]/u.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function prgCapacity(step: Pick<PrgLoadStep, 'loadAddress' | 'bank'>): number {
  if (step.loadAddress < 0x8000) return 0x8000 - step.loadAddress;
  if (step.bank === undefined) return 0;
  return (32 - step.bank) * 0x4000 - (step.loadAddress - 0x8000);
}

/** Validate an untrusted, versioned load plan without coercion. */
export function checkLoadPlan(value: unknown): ValidationResult<LoadPlan> {
  const diagnostics = schemaDiagnostics('load-plan', value);
  if (diagnostics.length) return result(value, diagnostics);
  const plan = value as LoadPlan;
  const acknowledged = new Set(plan.acknowledgedIssues ?? []);
  let terminal = -1;

  plan.steps.forEach((step, index) => {
    const base = `/steps/${index}`;
    if (!portablePath(step.path)) {
      diagnostics.push(diagnostic('load.path', `${base}/path`, 'Expected a relative portable path without traversal, quotes, or control characters'));
    }
    if (step.kind === 'mia') {
      const end = step.address + step.length;
      if (end > MIA_SIZE) diagnostics.push(diagnostic('load.mia.bounds', base, 'MIA load exceeds the 256 KiB MIA RAM'));
      if (step.address < OVERLAP_END && end > OVERLAP_START && !acknowledged.has(knownLoadIssue)) {
        diagnostics.push(diagnostic('load.known-issue', base, `Load intersects unresolved ${knownLoadIssue}; acknowledge it explicitly to retain this address`));
      }
      return;
    }

    const banked = step.loadAddress >= 0x8000;
    if (banked && step.bank === undefined) diagnostics.push(diagnostic('load.prg.bank', `${base}/bank`, 'Bank 1-31 is required for a PRG loading at $8000-$BFFF'));
    if (!banked && step.bank !== undefined) diagnostics.push(diagnostic('load.prg.bank', `${base}/bank`, 'An unbanked PRG must not declare a bank'));
    if (step.length > prgCapacity(step)) diagnostics.push(diagnostic('load.prg.bounds', base, 'PRG payload exceeds its available unbanked RAM or banks 1-31'));
    if (step.runAddress !== undefined) {
      if (terminal !== -1) diagnostics.push(diagnostic('load.run.multiple', `${base}/runAddress`, 'Only one terminal run step is allowed'));
      terminal = index;
    } else if (!banked) {
      diagnostics.push(diagnostic('load.prg.return', base, `Portable plans do not use returning unbanked BLOADs: below $${KERNEL_BASE.toString(16).toUpperCase()} is system RAM and at/above it may overwrite BASIC; use a banked image or make it the terminal run step`));
    }
  });

  if (terminal === -1) diagnostics.push(diagnostic('load.run.missing', '/steps', 'A terminal PRG step with runAddress is required'));
  else if (terminal !== plan.steps.length - 1) diagnostics.push(diagnostic('load.run.order', `/steps/${terminal}`, 'The run step must be last because it does not return to BASIC'));
  return result(value, diagnostics);
}

export function validateLoadPlan(value: unknown): asserts value is LoadPlan {
  assertValid(checkLoadPlan(value));
}

function basicLine(number: number, statement: string, diagnostics: ClementinaDiagnostic[], path: string): string {
  const line = `${number} ${statement}`;
  if (line.length > BASIC_LINE_LIMIT) diagnostics.push(diagnostic('load.basic.line', path, `Generated BASIC line exceeds the ${BASIC_LINE_LIMIT}-character input limit`));
  return line;
}

/** Render source lines for the ROM tokenizer. This does not implement a second tokenizer. */
export function checkBootstrapSource(value: unknown): ValidationResult<string[]> {
  const checked = checkLoadPlan(value);
  if (!checked.ok) return checked as ValidationResult<string[]>;
  const diagnostics: ClementinaDiagnostic[] = [];
  const lines = checked.value.steps.map((step, index) => {
    let statement: string;
    if (step.kind === 'mia') {
      statement = `MIALOAD "${step.path}",${step.address}${step.length <= 0xffff ? `,${step.length}` : ''}`;
    } else {
      statement = `BLOAD "${step.path}"${step.runAddress === undefined ? '' : `,${step.runAddress}`}`;
    }
    return basicLine((index + 1) * 10, statement, diagnostics, `/steps/${index}/path`);
  });
  return result(lines, diagnostics);
}

export function renderBootstrapSource(value: unknown): string {
  return assertValid(checkBootstrapSource(value)).join('\n') + '\n';
}

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
