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
  /** Payload length, excluding the 2-byte PRG header. */
  length: number;
  /** Bank 0-31 that BANK picks before the load, for the bytes from $8000 up; 0 when omitted. */
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
/** SD/FS control/sector/path/dir/transfer state (see specs/storage.json); loading over it only warns. */
const SDFS_RESERVED_START = 0x13000;
const SDFS_RESERVED_END = 0x13c00;
const KERNEL_BASE = 0x0400;

/** Check whether a path can be safely emitted inside a ROM BASIC quoted argument. */
function portablePath(path: string): boolean {
  return path.length > 0 && path.length <= 255 && !path.startsWith('/') && !path.includes('\\')
    && !path.includes('"') && !/[\u0000-\u001f\u007f]/u.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** Count the payload bytes available from a PRG load address through bank 31. */
function prgCapacity(step: Pick<PrgLoadStep, 'loadAddress' | 'bank'>): number {
  const banks = (32 - (step.bank ?? 0)) * 0x4000;
  return step.loadAddress < 0x8000 ? 0x8000 - step.loadAddress + banks : banks - (step.loadAddress - 0x8000);
}

/** A diagnostic that reports a likely mistake without failing the plan. */
function warning(code: string, path: string, message: string): ClementinaDiagnostic {
  return {...diagnostic(code, path, message), severity: 'warning'};
}

/**
 * Validate an untrusted, versioned load plan without coercion. The ROM loads
 * wherever a plan says, so a destination that may overwrite BASIC or the SD/FS
 * state is a warning, not an error.
 */
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
        diagnostics.push(warning('load.mia.reserved', base, 'MIA load overlaps the SD/FS state at $13000-$13BFF that later file commands rely on'));
      }
      return;
    }

    if (step.kind === 'basic') {
      if (terminal !== -1) diagnostics.push(diagnostic('load.run.multiple', base, 'Only one terminal program step is allowed'));
      terminal = index;
      return;
    }

    const banked = step.loadAddress >= 0x8000;
    if (step.length > prgCapacity(step)) diagnostics.push(diagnostic('load.prg.bounds', base, 'PRG payload runs past bank 31'));
    if (step.runAddress !== undefined) {
      if (terminal !== -1) diagnostics.push(diagnostic('load.run.multiple', `${base}/runAddress`, 'Only one terminal run step is allowed'));
      terminal = index;
    } else if (!banked || !step.bank) {
      diagnostics.push(warning('load.prg.return', base, `This BLOAD returns to BASIC: below $${KERNEL_BASE.toString(16).toUpperCase()} is system RAM, and from there up through bank 0 it may overwrite the kernel or BASIC unless the program lowered MEMSIZ; banks 1-31 are always safe`));
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

/**
 * Render validated load steps as ROM BASIC statements. Each PRG step picks its
 * bank with BANK first, unless the step before it already did; BANK is left
 * as the user had it until the first PRG step, and a later BASIC program gets
 * bank 0 back.
 */
function loadStatements(steps: readonly LoadStep[]): string[] {
  let bank: number | undefined;
  return steps.map(step => {
    if (step.kind === 'mia') return `MIALOAD "${step.path}",${step.address}`;
    const wanted = step.kind === 'prg' ? step.bank ?? 0 : bank === undefined ? undefined : 0;
    const select = wanted === undefined || wanted === bank ? '' : `BANK ${wanted}:`;
    bank = wanted;
    if (step.kind === 'basic') return `${select}LOAD "${step.path}"`;
    if (step.runAddress === undefined) return `${select}BLOAD "${step.path}"`;
    return `${select}BRUN "${step.path}"${step.runAddress === step.loadAddress ? '' : `,${step.runAddress}`}`;
  });
}

/** Render numbered lines after the shared load-plan validation has passed. */
function numberedBootstrap(plan: LoadPlan): ValidationResult<string[]> {
  const diagnostics: ClementinaDiagnostic[] = [];
  const statements = loadStatements(plan.steps);
  const lines = plan.steps.map((step, index) => {
    if (step.kind === 'basic') {
      diagnostics.push(diagnostic('load.basic.bootstrap', `/steps/${index}`, 'A BASIC terminal program uses direct launch commands, not a numbered bootstrap'));
    }
    return editorLine(statements[index]!, diagnostics, `/steps/${index}/path`, (index + 1) * 10);
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
  const statements = loadStatements(checked.value.steps);
  const lines = statements.map((statement, index) => editorLine(statement, diagnostics, `/steps/${index}/path`));
  return result({mode: 'direct', lines, startCommand: 'RUN'}, diagnostics);
}

/** Assert and return the editor commands for an assembly or BASIC launch. */
export function renderLoadPlanLaunch(value: unknown): LoadPlanLaunch {
  return assertValid(checkLoadPlanLaunch(value));
}
