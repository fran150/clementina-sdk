import {
  EmulatorClient,
  type ExecutionState,
  type LaunchLoadPlanOptions,
  type SourceMapResolver,
  type SourceStepLocation,
  type SourceStepOptions,
  type SourceStepResult,
  type SourceBreakpointLocation,
} from '@clementina/emulator-client';
import type {LoadPlan} from '@clementina/basic';
import {SerialQueue} from '@clementina/core';
import {decodeInstructions} from './disassembly.js';
import {isCpuAddress, isSourceBank, SourceBreakpointManager} from './breakpoints.js';
import {stopWaitInterval, waitForPoll} from './polling.js';
import {DebugSessionError} from './errors.js';
import {cpuAddressLabel, sourceName} from './format.js';
export * from './basic.js';
export * from './disassembly.js';

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
  locations?: SourceBreakpointLocation[];
  /** Present for unresolved lines. */
  message?: string;
}

export interface DebugInstruction {
  address: number;
  bank?: number;
  bytes: number[];
  text: string;
  source?: {path: string; line: number};
}

export interface DebugRegisters {
  pc: number;
  bank?: number;
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
  bank?: number;
  source?: {path: string; line: number};
  locations: SourceStepLocation[];
}

export interface DebugSnapshot {
  state: ExecutionState;
  thread: {id: number; name: string};
  frame: DebugFrame;
  registers: DebugRegisters;
}
export interface DebugStack {frames: DebugFrame[]; unknownCaller: boolean}

export interface WaitForStopOptions {
  /** Host orchestration timeout, unrelated to emulated timing. */
  timeoutMs: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export {DebugSessionError} from './errors.js';

/**
 * Editor-neutral debugger orchestration. Protocol/UI adapters should remain thin
 * translations over this class rather than reimplementing breakpoint ownership.
 */
export class ClementinaDebugSession {
  private readonly bank?: number;
  private readonly threadName: string;
  private readonly breakpoints: SourceBreakpointManager;
  private readonly commands = new SerialQueue();
  private disposed = false;

  /** Create an assembly session over an emulator client and source resolver. */
  constructor(
    private readonly client: EmulatorClient,
    private readonly sourceMap: SourceMapResolver,
    options: DebugSessionOptions = {},
  ) {
    if (options.bank !== undefined && !isSourceBank(options.bank)) throw new RangeError('bank must be 1..31');
    if (options.threadName !== undefined && options.threadName.length === 0) throw new TypeError('threadName must not be empty');
    this.bank = options.bank;
    this.threadName = options.threadName ?? 'Clementina 65C02';
    this.breakpoints = new SourceBreakpointManager(client, sourceMap, this.bank);
  }

  /** Return the single CPU thread presented to editor clients. */
  threads(): readonly [{id: number; name: string}] {
    return [{id: CLEMENTINA_CPU_THREAD_ID, name: this.threadName}];
  }

  /** Read execution state and build its source-aware frame and registers. */
  snapshot(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.executionState()));
  }

  /** Return the leaf frame plus callers verified by the emulator's trace. */
  stackTrace(): Promise<DebugStack> {
    return this.command(async () => {
      const state = await this.client.executionState();
      if (state.running) throw new DebugSessionError('Pause before stack inspection');
      const leaf = this.snapshotFromState(state).frame;
      const stack = await this.client.stackTrace();
      const frames = [leaf];
      for (const caller of stack.callers) {
        const locations = this.sourceLocations(caller.pc, caller.bank);
        const primary = locations[0];
        frames.push({id: frames.length + 1, threadId: CLEMENTINA_CPU_THREAD_ID,
          name: primary ? `${sourceName(primary.path)}:${primary.line} (${caller.kind})`
            : `${cpuAddressLabel(caller.pc)} (${caller.kind})`,
          instructionPointer: caller.pc, bank: caller.bank, ...(primary ? {source: {path: primary.path, line: primary.line}} : {}), locations});
      }
      return {frames, unknownCaller: stack.unknownCaller};
    });
  }

  /** Resume execution, including from a just-hit breakpoint. */
  continue(): Promise<ExecutionState> {
    return this.command(() => this.client.resume());
  }

  /** Stop execution and return a snapshot of the paused CPU. */
  pause(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.pause()));
  }

  /** Reset the emulator and return its new execution snapshot. */
  reset(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(this.requireExecutionState(await this.client.reset())));
  }

  /** Execute a validated load plan and start the program. */
  launch(plan: LoadPlan, options: LaunchLoadPlanOptions = {}): Promise<ExecutionState> {
    return this.command(() => this.client.launchLoadPlan(plan, options));
  }

  /** Step to the next source location, entering calls. */
  stepIn(options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return this.command(() => this.client.stepSource(this.sourceMap, this.stepOptions(options)));
  }

  /** Step to the next source location, stepping over calls when possible. */
  next(options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return this.command(() => this.client.stepOverSource(this.sourceMap, this.stepOptions(options)));
  }

  /** Execute one machine instruction within the supplied cycle budget. */
  stepInstruction(maxCycles = 10000): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.stepInstruction(maxCycles)));
  }

  /** Read CPU-mapped memory, preserving unreadable bytes as null. */
  readMemory(address: number, count: number): Promise<(number | null)[]> {
    return this.command(() => this.client.readMemory(address, count));
  }

  /** Read and decode at most 64 instructions from one stopped memory image. */
  disassemble(address: number, count: number, selectedBank?: number): Promise<DebugInstruction[]> {
    return this.command(async () => {
      if (!isCpuAddress(address) || !Number.isInteger(count) || count < 1 || count > 64) throw new RangeError('Invalid disassembly range');
      if (selectedBank !== undefined && (!Number.isInteger(selectedBank) || selectedBank < 0 || selectedBank > 31)) throw new RangeError('Invalid RAM bank');
      const state = await this.client.executionState();
      if (state.running) throw new DebugSessionError('Pause before disassembly');
      const bank = address >= 0x8000 && address < 0xc000 ? selectedBank ?? state.bank : undefined;
      if (address >= 0x8000 && address < 0xc000 && bank === undefined) throw new DebugSessionError('Emulator did not report the selected RAM bank');
      const end = Math.min(0x10000, bank === undefined ? 0x10000 : 0xc000, address + count * 3);
      const data = await this.client.readMemory(address, end - address, bank);
      return decodeInstructions(address, data, count).map(item => {
        const source = this.sourceLocations(item.address, item.address >= 0x8000 && item.address < 0xc000 ? bank : undefined)[0];
        return {...item, ...(item.address >= 0x8000 && item.address < 0xc000 ? {bank} : {}),
          ...(source ? {source: {path: source.path, line: source.line}} : {})};
      });
    });
  }

  /** Replace all source breakpoints for one path, preserving other paths and external addresses. */
  setSourceBreakpoints(path: string, lines: readonly number[]): Promise<DebugBreakpoint[]> {
    return this.command(() => this.breakpoints.set(path, lines));
  }

  /** Remove every source breakpoint installed by this session. */
  clearSourceBreakpoints(): Promise<void> {
    return this.command(() => this.breakpoints.clear());
  }

  /** Remove only breakpoints installed by this session. */
  dispose(): Promise<void> {
    if (this.disposed) return this.commands.idle;
    return this.command(async () => {
      await this.breakpoints.clear();
      this.disposed = true;
    }, true);
  }

  /** Poll a running emulator without blocking pause or other queued editor commands. */
  async waitForStop(options: WaitForStopOptions): Promise<DebugSnapshot> {
    if (this.disposed) throw new DebugSessionError('Debug session is disposed');
    const interval = stopWaitInterval(options);
    const deadline = Date.now() + options.timeoutMs;
    while (true) {
      if (options.signal?.aborted) throw new DebugSessionError('Stop wait aborted');
      const state = await this.client.executionState();
      if (!state.running) return this.snapshotFromState(state);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DebugSessionError('Timed out waiting for emulator to stop');
      await waitForPoll(Math.min(interval, remaining), options.signal, () => new DebugSessionError('Stop wait aborted'));
    }
  }

  /** Serialize editor commands and keep the queue usable after a failure. */
  private command<T>(operation: () => Promise<T>, allowDisposed = false): Promise<T> {
    return this.commands.run(() => {
      if (this.disposed && !allowDisposed) throw new DebugSessionError('Debug session is disposed');
      return operation();
    });
  }

  /** Apply the session bank unless a step explicitly selects another bank. */
  private stepOptions(options: SourceStepOptions): SourceStepOptions {
    return {...options, ...(options.bank === undefined && this.bank !== undefined ? {bank: this.bank} : {})};
  }

  /** Convert an emulator state into the editor-neutral thread and leaf frame. */
  private snapshotFromState(state: ExecutionState): DebugSnapshot {
    const locations = this.sourceLocations(state.pc, state.bank ?? this.bank);
    const primary = locations[0];
    return {
      state,
      thread: {id: CLEMENTINA_CPU_THREAD_ID, name: this.threadName},
      frame: {
        id: CLEMENTINA_CPU_FRAME_ID, threadId: CLEMENTINA_CPU_THREAD_ID,
        name: primary ? `${sourceName(primary.path)}:${primary.line}` : cpuAddressLabel(state.pc),
        instructionPointer: state.pc,
        ...(state.bank === undefined ? {} : {bank: state.bank}),
        ...(primary === undefined ? {} : {source: {path: primary.path, line: primary.line}}),
        locations,
      },
      registers: {pc: state.pc, ...(state.bank === undefined ? {} : {bank: state.bank}), a: state.a, x: state.x, y: state.y, sp: state.sp, p: state.p, cycles: state.cycles, miaPaused: state.paused},
    };
  }

  /** Validate and sort all mapped source locations at a CPU address. */
  private sourceLocations(address: number, bank = this.bank): SourceStepLocation[] {
    const locations = this.sourceMap.locationsForAddress(address, bank);
    if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
    return locations.map(location => {
      if (typeof location !== 'object' || location === null || typeof location.path !== 'string' || location.path.length === 0
        || !Number.isInteger(location.line) || location.line < 1 || !isCpuAddress(location.address)
        || (location.bank !== undefined && !isSourceBank(location.bank))) throw new TypeError('Invalid source map location');
      return {path: location.path, line: location.line, address: location.address, ...(location.bank === undefined ? {} : {bank: location.bank})};
    }).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.address - b.address);
  }

  /** Check that reset returned the extended execution fields required here. */
  private requireExecutionState(state: Awaited<ReturnType<EmulatorClient['state']>>): ExecutionState {
    if (typeof state.running !== 'boolean' || typeof state.stopReason !== 'string' || typeof state.instructionBoundary !== 'boolean') {
      throw new DebugSessionError('Emulator does not provide execution state');
    }
    return state as ExecutionState;
  }
}
