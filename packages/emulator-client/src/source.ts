import {SourceBreakpointError, SourceStepError} from './errors.js';
import {isInteger, isObject} from './validation.js';
import type {
  BankBreakpoint, ExecutionState, SourceBreakpointLocation, SourceBreakpointResolver, SourceBreakpointResult,
  SourceMapResolver, SourceStepLocation, SourceStepOptions, SourceStepReason, SourceStepResult,
} from './index.js';

/** Operations needed to install and remove resolved source breakpoints. */
export interface BreakpointClient {
  /** Add a logical CPU address breakpoint. */
  addBreakpoint(address: number): Promise<number[]>;
  /** Remove a logical CPU address breakpoint. */
  removeBreakpoint(address: number): Promise<number[]>;
  /** Add a physical bank breakpoint. */
  addBankBreakpoint(address: number, bank: number): Promise<BankBreakpoint[]>;
  /** Remove a physical bank breakpoint. */
  removeBankBreakpoint(address: number, bank: number): Promise<BankBreakpoint[]>;
}

/** Operations needed to advance through machine instructions. */
export interface StepClient {
  /** Read a state with execution metadata. */
  executionState(): Promise<ExecutionState>;
  /** Read CPU-mapped bytes for opcode inspection. */
  readMemory(address: number, count: number): Promise<(number | null)[]>;
  /** Advance to the next machine instruction boundary. */
  stepInstruction(maxCycles?: number): Promise<ExecutionState>;
}

/** Reject malformed or zero bank metadata in a source map location. */
function isSourceBank(bank: unknown): bank is number | undefined {
  return bank === undefined || (isInteger(bank, 31) && bank !== 0);
}

/** Resolve, validate, and deduplicate the exact span starts of one source line. */
function breakpointLocations(sourceMap: SourceBreakpointResolver, path: string, line: number): SourceBreakpointLocation[] {
  const locations = sourceMap.locationsForSource(path, line);
  if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
  const resolved = new Map<string, SourceBreakpointLocation>();
  for (const location of locations) {
    if (!isObject(location) || !isInteger(location.address, 65535) || !isSourceBank(location.bank)) {
      throw new TypeError('Invalid source map location');
    }
    const item = {address: location.address, ...(location.bank === undefined ? {} : {bank: location.bank})};
    resolved.set(`${item.address}:${item.bank ?? ''}`, item);
  }
  return [...resolved.values()];
}

/** Apply one source line's breakpoints in source-map order. A failed transport can leave a prefix applied. */
export async function updateSourceBreakpoint(
  client: BreakpointClient, operation: 'add' | 'remove', sourceMap: SourceBreakpointResolver,
  path: string, line: number,
): Promise<SourceBreakpointResult> {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must be a non-empty string');
  if (!Number.isInteger(line) || line < 1) throw new RangeError('line must be a positive integer');
  const locations = breakpointLocations(sourceMap, path, line);
  if (locations.length === 0) throw new SourceBreakpointError(`No executable code at ${path}:${line}`);

  let breakpoints: number[] = [];
  let bankBreakpoints: BankBreakpoint[] = [];
  for (const location of locations) {
    if (location.bank === undefined) {
      breakpoints = operation === 'add'
        ? await client.addBreakpoint(location.address) : await client.removeBreakpoint(location.address);
    } else {
      bankBreakpoints = operation === 'add'
        ? await client.addBankBreakpoint(location.address, location.bank)
        : await client.removeBankBreakpoint(location.address, location.bank);
    }
  }
  return {
    path, line, addresses: [...new Set(locations.map(location => location.address))],
    locations, banked: locations.some(location => location.bank !== undefined), breakpoints, bankBreakpoints,
  };
}

/** Resolve and sort every exact source location containing a CPU address. */
function sourceLocations(sourceMap: SourceMapResolver, address: number, bank: number | undefined): SourceStepLocation[] {
  const locations = sourceMap.locationsForAddress(address, bank);
  if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
  return locations.map(location => {
    if (!isObject(location) || typeof location.path !== 'string' || location.path.length === 0
      || !isInteger(location.line, Number.MAX_SAFE_INTEGER) || location.line === 0
      || !isInteger(location.address, 65535) || !isSourceBank(location.bank)) {
      throw new TypeError('Invalid source map location');
    }
    return {path: location.path, line: location.line, address: location.address,
      ...(location.bank === undefined ? {} : {bank: location.bank})};
  }).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.address - b.address || (a.bank ?? 0) - (b.bank ?? 0));
}

/** Compare source identities while ignoring multiple spans on one line. */
function sourceLocationKeys(locations: readonly SourceStepLocation[]): string[] {
  return [...new Set(locations.map(location => `${location.path}\0${location.line}\0${location.bank ?? ''}`))].sort();
}

/** Translate a machine stop into a source-step reason, if stepping must stop. */
function sourceStepTerminal(state: ExecutionState): SourceStepReason | undefined {
  if (state.stopReason === 'instruction' && state.instructionBoundary) return undefined;
  if (state.stopReason === 'cycle-limit' || state.stopReason === 'mia-paused' || state.stopReason === 'cpu-stopped') return state.stopReason;
  return 'stopped';
}

/** Package the final machine state with its exact source locations. */
function sourceStepResult(
  state: ExecutionState, reason: SourceStepReason, instructions: number, startLocations: SourceStepLocation[],
  sourceMap: SourceMapResolver, bank: number | undefined, steppedOverCall: boolean,
): SourceStepResult {
  return {state, reason, instructions, startLocations, locations: sourceLocations(sourceMap, state.pc, bank), steppedOverCall};
}

/** Advance to a new exact source location, optionally stepping through a JSR return. */
export async function stepSource(
  client: StepClient, mode: 'into' | 'over', sourceMap: SourceMapResolver, options: SourceStepOptions,
): Promise<SourceStepResult> {
  const maxInstructions = options.maxInstructions ?? 10000;
  const maxCycles = options.maxCyclesPerInstruction ?? 10000;
  if (!isInteger(maxInstructions, 10_000_000) || maxInstructions === 0) throw new RangeError('maxInstructions must be 1..10000000');
  if (!isInteger(maxCycles, 10_000_000) || maxCycles === 0) throw new RangeError('maxCyclesPerInstruction must be 1..10000000');
  if (options.bank !== undefined && !isSourceBank(options.bank)) throw new RangeError('bank must be 1..31');

  let current = await client.executionState();
  if (current.running) throw new SourceStepError('Pause before source stepping');
  if (!current.instructionBoundary) throw new SourceStepError('Source stepping requires an instruction boundary');
  const startLocations = sourceLocations(sourceMap, current.pc, current.bank ?? options.bank);
  const startKeys = sourceLocationKeys(startLocations);
  const startPC = current.pc;
  const startSP = current.sp;
  const startBank = current.bank;
  let instructions = 0;
  let steppedOverCall = false;

  if (mode === 'over') {
    const opcode = await client.readMemory(startPC, 1);
    if (opcode[0] === null) throw new SourceStepError(`Cannot inspect opcode at $${startPC.toString(16).toUpperCase().padStart(4, '0')}`);
    if (opcode[0] === 0x20) {
      steppedOverCall = true;
      const returnPC = (startPC + 3) & 0xffff;
      while (instructions < maxInstructions) {
        current = await client.stepInstruction(maxCycles);
        instructions++;
        const terminal = sourceStepTerminal(current);
        if (terminal !== undefined) return sourceStepResult(current, terminal, instructions, startLocations, sourceMap, current.bank ?? options.bank, true);
        if (current.pc === returnPC && current.sp === startSP && current.bank === startBank) break;
      }
      if (current.pc !== returnPC || current.sp !== startSP || current.bank !== startBank) {
        return sourceStepResult(current, 'instruction-limit', instructions, startLocations, sourceMap, current.bank ?? options.bank, true);
      }
    }
  }

  while (instructions < maxInstructions) {
    if (steppedOverCall || instructions > 0) {
      const locations = sourceLocations(sourceMap, current.pc, current.bank ?? options.bank);
      if (startKeys.length === 0 || locations.length === 0) {
        return {state: current, reason: 'unmapped', instructions, startLocations, locations, steppedOverCall};
      }
      const keys = sourceLocationKeys(locations);
      if (keys.length !== startKeys.length || keys.some((key, index) => key !== startKeys[index])) {
        return {state: current, reason: 'source-location', instructions, startLocations, locations, steppedOverCall};
      }
    }
    current = await client.stepInstruction(maxCycles);
    instructions++;
    const terminal = sourceStepTerminal(current);
    if (terminal !== undefined) return sourceStepResult(current, terminal, instructions, startLocations, sourceMap, current.bank ?? options.bank, steppedOverCall);
  }
  return sourceStepResult(current, 'instruction-limit', instructions, startLocations, sourceMap, current.bank ?? options.bank, steppedOverCall);
}
