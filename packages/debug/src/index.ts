import {
  EmulatorClient,
  type ExecutionState,
  type LaunchLoadPlanOptions,
  type SourceMapResolver,
  type SourceStepLocation,
  type SourceStepOptions,
  type SourceStepResult,
} from '@clementina/emulator-client';
import type {LoadPlan} from '@clementina/basic';

export const CLEMENTINA_CPU_THREAD_ID = 1;
export const CLEMENTINA_CPU_FRAME_ID = 1;

export interface DebugSessionOptions {
  /** Select source metadata for a particular Clementina extended-RAM bank. */
  bank?: number;
  threadName?: string;
}

export interface DebugBreakpoint {
  path: string;
  requestedLine: number;
  verified: boolean;
  line?: number;
  addresses: number[];
  /** Present for unresolved lines and logical-only banked breakpoints. */
  message?: string;
}

export interface DebugRegisters {
  pc: number;
  a: number;
  x: number;
  y: number;
  sp: number;
  p: number;
  cycles: string;
  miaPaused: boolean;
}

export interface DebugFrame {
  id: number;
  threadId: number;
  name: string;
  instructionPointer: number;
  source?: {path: string; line: number};
  locations: SourceStepLocation[];
}

export interface DebugSnapshot {
  state: ExecutionState;
  thread: {id: number; name: string};
  frame: DebugFrame;
  registers: DebugRegisters;
}

export interface WaitForStopOptions {
  /** Host orchestration timeout, unrelated to emulated timing. */
  timeoutMs: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export class DebugSessionError extends Error {}

const validAddress = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff;
const validBank = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 31;

/**
 * Editor-neutral debugger orchestration. Protocol/UI adapters should remain thin
 * translations over this class rather than reimplementing breakpoint ownership.
 */
export class ClementinaDebugSession {
  private readonly bank?: number;
  private readonly threadName: string;
  private readonly sourceBreakpoints = new Map<string, Map<number, number[]>>();
  private readonly installedBySession = new Set<number>();
  private commandTail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly client: EmulatorClient,
    private readonly sourceMap: SourceMapResolver,
    options: DebugSessionOptions = {},
  ) {
    if (options.bank !== undefined && !validBank(options.bank)) throw new RangeError('bank must be 1..31');
    if (options.threadName !== undefined && options.threadName.length === 0) throw new TypeError('threadName must not be empty');
    this.bank = options.bank;
    this.threadName = options.threadName ?? 'Clementina 65C02';
  }

  threads(): readonly [{id: number; name: string}] {
    return [{id: CLEMENTINA_CPU_THREAD_ID, name: this.threadName}];
  }

  snapshot(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.executionState()));
  }

  continue(): Promise<ExecutionState> {
    return this.command(() => this.client.resume());
  }

  pause(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.pause()));
  }

  reset(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(this.requireExecutionState(await this.client.reset())));
  }

  launch(plan: LoadPlan, options: LaunchLoadPlanOptions = {}): Promise<ExecutionState> {
    return this.command(() => this.client.launchLoadPlan(plan, options));
  }

  stepIn(options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return this.command(() => this.client.stepSource(this.sourceMap, this.stepOptions(options)));
  }

  next(options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return this.command(() => this.client.stepOverSource(this.sourceMap, this.stepOptions(options)));
  }

  stepInstruction(maxCycles = 10000): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.stepInstruction(maxCycles)));
  }

  readMemory(address: number, count: number): Promise<(number | null)[]> {
    return this.command(() => this.client.readMemory(address, count));
  }

  /** Replace all source breakpoints for one path, preserving other paths and external addresses. */
  setSourceBreakpoints(path: string, lines: readonly number[]): Promise<DebugBreakpoint[]> {
    return this.command(() => this.setSourceBreakpointsNow(path, lines));
  }

  clearSourceBreakpoints(): Promise<void> {
    return this.command(async () => {
      for (const address of [...this.installedBySession].sort((a, b) => a - b)) {
        await this.client.removeBreakpoint(address);
        this.installedBySession.delete(address);
      }
      this.sourceBreakpoints.clear();
    });
  }

  /** Remove only address breakpoints installed by this session. */
  dispose(): Promise<void> {
    if (this.disposed) return this.commandTail;
    return this.command(async () => {
      for (const address of [...this.installedBySession].sort((a, b) => a - b)) await this.client.removeBreakpoint(address);
      this.installedBySession.clear();
      this.sourceBreakpoints.clear();
      this.disposed = true;
    }, true);
  }

  /** Poll a running emulator without blocking pause or other queued editor commands. */
  async waitForStop(options: WaitForStopOptions): Promise<DebugSnapshot> {
    if (this.disposed) throw new DebugSessionError('Debug session is disposed');
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new RangeError('timeoutMs must be a positive integer');
    const interval = options.pollIntervalMs ?? 10;
    if (!Number.isInteger(interval) || interval < 1 || interval > options.timeoutMs) throw new RangeError('pollIntervalMs must be 1..timeoutMs');
    const deadline = Date.now() + options.timeoutMs;
    while (true) {
      if (options.signal?.aborted) throw new DebugSessionError('Stop wait aborted');
      const state = await this.client.executionState();
      if (!state.running) return this.snapshotFromState(state);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DebugSessionError('Timed out waiting for emulator to stop');
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const abort = () => { clearTimeout(timer); reject(new DebugSessionError('Stop wait aborted')); };
        const done = () => { options.signal?.removeEventListener('abort', abort); resolve(); };
        timer = setTimeout(done, Math.min(interval, remaining));
        options.signal?.addEventListener('abort', abort, {once: true});
        if (options.signal?.aborted) abort();
      });
    }
  }

  private command<T>(operation: () => Promise<T>, allowDisposed = false): Promise<T> {
    const result = this.commandTail.then(async () => {
      if (this.disposed && !allowDisposed) throw new DebugSessionError('Debug session is disposed');
      return operation();
    });
    this.commandTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private stepOptions(options: SourceStepOptions): SourceStepOptions {
    return {...options, ...(options.bank === undefined && this.bank !== undefined ? {bank: this.bank} : {})};
  }

  private resolveLine(path: string, line: number): {addresses: number[]; banked: boolean} {
    const locations = this.sourceMap.locationsForSource(path, line);
    if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
    let banked = false;
    const addresses: number[] = [];
    for (const location of locations) {
      if (typeof location !== 'object' || location === null || !validAddress(location.address)
        || (location.bank !== undefined && !validBank(location.bank))) throw new TypeError('Invalid source map location');
      if (this.bank !== undefined && location.bank !== undefined && location.bank !== this.bank) continue;
      if (location.bank !== undefined) banked = true;
      if (!addresses.includes(location.address)) addresses.push(location.address);
    }
    addresses.sort((a, b) => a - b);
    return {addresses, banked};
  }

  private async setSourceBreakpointsNow(path: string, lines: readonly number[]): Promise<DebugBreakpoint[]> {
    if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must be a non-empty string');
    if (!Array.isArray(lines) || lines.some(line => !Number.isInteger(line) || line < 1)) throw new RangeError('lines must contain positive integers');
    const resolved = lines.map(line => ({line, ...this.resolveLine(path, line)}));
    const replacement = new Map<number, number[]>();
    for (const item of resolved) if (item.addresses.length > 0) replacement.set(item.line, item.addresses);

    const desired = new Set<number>();
    for (const [existingPath, byLine] of this.sourceBreakpoints) {
      if (existingPath === path) continue;
      for (const addresses of byLine.values()) for (const address of addresses) desired.add(address);
    }
    for (const addresses of replacement.values()) for (const address of addresses) desired.add(address);

    const active = new Set(await this.client.breakpoints());
    for (const address of [...desired].sort((a, b) => a - b)) {
      if (active.has(address)) continue;
      const current = await this.client.addBreakpoint(address);
      active.clear(); for (const value of current) active.add(value);
      this.installedBySession.add(address);
    }
    for (const address of [...this.installedBySession].sort((a, b) => a - b)) {
      if (desired.has(address)) continue;
      const current = await this.client.removeBreakpoint(address);
      active.clear(); for (const value of current) active.add(value);
      this.installedBySession.delete(address);
    }
    if (replacement.size === 0) this.sourceBreakpoints.delete(path);
    else this.sourceBreakpoints.set(path, replacement);

    return resolved.map(item => item.addresses.length === 0
      ? {path, requestedLine: item.line, verified: false, addresses: [], message: 'No executable code at this line'}
      : {
          path, requestedLine: item.line, verified: true, line: item.line, addresses: item.addresses,
          ...(item.banked ? {message: 'Breakpoint uses a logical CPU address and is not bank-selective'} : {}),
        });
  }

  private snapshotFromState(state: ExecutionState): DebugSnapshot {
    const locations = this.sourceLocations(state.pc);
    const primary = locations[0];
    const leaf = primary?.path.replaceAll('\\', '/').split('/').pop();
    return {
      state,
      thread: {id: CLEMENTINA_CPU_THREAD_ID, name: this.threadName},
      frame: {
        id: CLEMENTINA_CPU_FRAME_ID, threadId: CLEMENTINA_CPU_THREAD_ID,
        name: primary ? `${leaf}:${primary.line}` : `$${state.pc.toString(16).toUpperCase().padStart(4, '0')}`,
        instructionPointer: state.pc,
        ...(primary === undefined ? {} : {source: {path: primary.path, line: primary.line}}),
        locations,
      },
      registers: {pc: state.pc, a: state.a, x: state.x, y: state.y, sp: state.sp, p: state.p, cycles: state.cycles, miaPaused: state.paused},
    };
  }

  private sourceLocations(address: number): SourceStepLocation[] {
    const locations = this.sourceMap.locationsForAddress(address, this.bank);
    if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
    return locations.map(location => {
      if (typeof location !== 'object' || location === null || typeof location.path !== 'string' || location.path.length === 0
        || !Number.isInteger(location.line) || location.line < 1 || !validAddress(location.address)
        || (location.bank !== undefined && !validBank(location.bank))) throw new TypeError('Invalid source map location');
      return {path: location.path, line: location.line, address: location.address, ...(location.bank === undefined ? {} : {bank: location.bank})};
    }).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.address - b.address);
  }

  private requireExecutionState(state: Awaited<ReturnType<EmulatorClient['state']>>): ExecutionState {
    if (typeof state.running !== 'boolean' || typeof state.stopReason !== 'string' || typeof state.instructionBoundary !== 'boolean') {
      throw new DebugSessionError('Emulator does not provide execution state');
    }
    return state as ExecutionState;
  }
}
