import {
  assertValid,
  diagnostic,
  result,
  schemaDiagnostics,
  type ClementinaDiagnostic,
  type ValidationResult,
} from '@clementina/core';
import {basicSourceLimits} from './token-tables.js';

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

export interface BasicLoadStep {
  kind: 'basic';
  path: string;
  /** Exact raw SAVE/LOAD file length. */
  length: number;
}

export type LoadStep = MiaLoadStep | PrgLoadStep | BasicLoadStep;
export interface LoadPlan {
  format: 'clementina-load-plan';
  version: 1;
  steps: LoadStep[];
}

export interface LoadPlanLaunch {
  /** Numbered lines define a temporary bootstrap; direct lines execute immediately. */
  mode: 'numbered' | 'direct';
  lines: string[];
  startCommand: 'RUN';
}

const MIA_SIZE = 0x40000;
/** SD/FS control/sector/path/dir/transfer state; permanently reserved (see specs/storage.json). */
const SDFS_RESERVED_START = 0x13000;
const SDFS_RESERVED_END = 0x13c00;
const KERNEL_BASE = 0x04b7;

/** Check whether a path can be safely emitted inside a ROM BASIC quoted argument. */
function portablePath(path: string): boolean {
  return path.length > 0 && path.length <= 255 && !path.startsWith('/') && !path.includes('\\')
    && !path.includes('"') && !/[\u0000-\u001f\u007f]/u.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** Count the payload bytes available from a PRG load address through supported RAM. */
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
  let terminal = -1;

  plan.steps.forEach((step, index) => {
    const base = `/steps/${index}`;
    if (!portablePath(step.path)) {
      diagnostics.push(diagnostic('load.path', `${base}/path`, 'Expected a relative portable path without traversal, quotes, or control characters'));
    }
    if (step.kind === 'mia') {
      const end = step.address + step.length;
      if (end > MIA_SIZE) diagnostics.push(diagnostic('load.mia.bounds', base, 'MIA load exceeds the 256 KiB MIA RAM'));
      if (step.address < SDFS_RESERVED_END && end > SDFS_RESERVED_START) {
        diagnostics.push(diagnostic('load.mia.reserved', base, 'MIA load overlaps the permanently reserved SD/FS state region $13000-$13BFF'));
      }
      return;
    }

    if (step.kind === 'basic') {
      if (terminal !== -1) diagnostics.push(diagnostic('load.run.multiple', base, 'Only one terminal program step is allowed'));
      terminal = index;
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

  if (terminal === -1) diagnostics.push(diagnostic('load.run.missing', '/steps', 'A terminal PRG run or BASIC program step is required'));
  else if (terminal !== plan.steps.length - 1) diagnostics.push(diagnostic('load.run.order', `/steps/${terminal}`, 'The run step must be last because it does not return to BASIC'));
  return result(value, diagnostics);
}

/** Assert that an untrusted value is a portable load plan. */
export function validateLoadPlan(value: unknown): asserts value is LoadPlan {
  assertValid(checkLoadPlan(value));
}

/** Check the ROM editor limit after adding an optional bootstrap line number. */
function editorLine(statement: string, diagnostics: ClementinaDiagnostic[], path: string, number?: number): string {
  const line = number === undefined ? statement : `${number} ${statement}`;
  if (line.length > basicSourceLimits.maxInputCharacters) {
    const kind = number === undefined ? 'command' : 'line';
    diagnostics.push(diagnostic('load.basic.line', path, `Generated BASIC ${kind} exceeds the ${basicSourceLimits.maxInputCharacters}-character input limit`));
  }
  return line;
}

/** Render one validated load step as a ROM BASIC statement. */
function loadStatement(step: LoadStep): string {
  if (step.kind === 'mia') return `MIALOAD "${step.path}",${step.address}${step.length <= 0xffff ? `,${step.length}` : ''}`;
  if (step.kind === 'basic') return `LOAD "${step.path}"`;
  return `BLOAD "${step.path}"${step.runAddress === undefined ? '' : `,${step.runAddress}`}`;
}

/** Render numbered lines after the shared load-plan validation has passed. */
function numberedBootstrap(plan: LoadPlan): ValidationResult<string[]> {
  const diagnostics: ClementinaDiagnostic[] = [];
  const lines = plan.steps.map((step, index) => {
    if (step.kind === 'basic') {
      diagnostics.push(diagnostic('load.basic.bootstrap', `/steps/${index}`, 'A BASIC terminal program uses direct launch commands, not a numbered bootstrap'));
    }
    return editorLine(loadStatement(step), diagnostics, `/steps/${index}/path`, (index + 1) * 10);
  });
  return result(lines, diagnostics);
}

/** Check source lines for the ROM tokenizer without implementing a second tokenizer. */
export function checkBootstrapSource(value: unknown): ValidationResult<string[]> {
  const checked = checkLoadPlan(value);
  return checked.ok ? numberedBootstrap(checked.value) : checked as ValidationResult<string[]>;
}

/** Render a numbered assembly bootstrap, ending with a newline. */
export function renderBootstrapSource(value: unknown): string {
  return assertValid(checkBootstrapSource(value)).join('\n') + '\n';
}

/** Validate and render the exact editor commands used to launch either program kind. */
export function checkLoadPlanLaunch(value: unknown): ValidationResult<LoadPlanLaunch> {
  const checked = checkLoadPlan(value);
  if (!checked.ok) return checked as ValidationResult<LoadPlanLaunch>;
  const launchesBasic = checked.value.steps.at(-1)?.kind === 'basic';
  if (!launchesBasic) {
    const bootstrap = numberedBootstrap(checked.value);
    return bootstrap.ok
      ? result({mode: 'numbered', lines: bootstrap.value, startCommand: 'RUN'}, [])
      : bootstrap as ValidationResult<LoadPlanLaunch>;
  }
  const diagnostics: ClementinaDiagnostic[] = [];
  const lines = checked.value.steps.map((step, index) => {
    return editorLine(loadStatement(step), diagnostics, `/steps/${index}/path`);
  });
  return result({mode: 'direct', lines, startCommand: 'RUN'}, diagnostics);
}

/** Assert and return the editor commands for an assembly or BASIC launch. */
export function renderLoadPlanLaunch(value: unknown): LoadPlanLaunch {
  return assertValid(checkLoadPlanLaunch(value));
}
