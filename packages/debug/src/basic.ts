import {basicRuntimeDebug, parseBasicSource, type LoadPlan} from '@clementina/basic';
import {SerialQueue} from '@clementina/core';
import {
  type EmulatorClient,
  type ExecutionState,
  type LaunchLoadPlanOptions,
  type SourceStepOptions,
  type SourceStepLocation,
  type SourceStepResult,
} from '@clementina/emulator-client';
import type {DebugBreakpoint, DebugSnapshot, WaitForStopOptions} from './index.js';
import {readBasicVariables, type BasicRuntimeVariable} from './basic-variables.js';
import {stopWaitInterval, waitForPoll} from './polling.js';
import {DebugSessionError} from './errors.js';
import {cpuAddressLabel, sourceName} from './format.js';
export type {BasicRuntimeVariable} from './basic-variables.js';

interface BasicLineLocation {number: number; physicalLine: number}
/** Host-side safety limits for waiting on a BASIC statement boundary. */
export interface BasicSourceStepOptions extends SourceStepOptions {timeoutMs?: number; pollIntervalMs?: number}

/** Keep the final nonempty definition of each validated numbered BASIC line. */
function effectiveLines(source: string): BasicLineLocation[] {
  const effectiveNumbers = new Set(parseBasicSource(source).map(line => line.number));
  const physicalByNumber = new Map<number, number>();
  source.replace(/\r\n?/gu, '\n').split('\n').forEach((raw, index) => {
    const match = /^\s*([0-9]+)/u.exec(raw);
    if (!match) return;
    const number = Number(match[1]);
    if (effectiveNumbers.has(number)) physicalByNumber.set(number, index + 1);
  });
  return [...physicalByNumber].map(([number, physicalLine]) => ({number, physicalLine})).sort((a, b) => a.number - b.number);
}

/** BASIC source debugger using the ROM's new-line hook in NEWSTT and CURLIN. */
export class ClementinaBasicDebugSession {
  private readonly lineByNumber: Map<number, BasicLineLocation>;
  private readonly numberByPhysical: Map<number, number>;
  private readonly requestedLines = new Set<number>();
  private hookOwned = false;
  /** Whether the emulator filters the statement hook by line by itself; unknown until asked. */
  private filterSupported?: boolean;
  /** Whether this session's line filter is installed on the statement hook. */
  private filtered = false;
  private disposed = false;
  private readonly commands = new SerialQueue();
  private pauseSequence = 0;
  private lastPause?: Promise<DebugSnapshot>;
  private disposing?: Promise<void>;

  /** Parse BASIC source and retain its effective numbered-line locations. */
  constructor(
    private readonly client: EmulatorClient,
    private readonly sourcePath: string,
    source: string,
    private readonly threadName = 'Clementina BASIC',
    /** Other spellings of the source path, such as its project-relative path. */
    private readonly aliases: readonly string[] = [],
  ) {
    if (!sourcePath) throw new TypeError('sourcePath must not be empty');
    const lines = effectiveLines(source);
    this.lineByNumber = new Map(lines.map(line => [line.number, line]));
    this.numberByPhysical = new Map(lines.map(line => [line.physicalLine, line.number]));
  }

  /** Return the single CPU thread presented to editor clients. */
  threads() { return [{id: 1, name: this.threadName}] as const; }

  /** Read execution state and map the current BASIC line when available. */
  snapshot(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.executionState()));
  }

  /** Resume BASIC, keeping the statement hook only while requested. */
  continue(): Promise<ExecutionState> {
    return this.command(async () => {
      if (this.requestedLines.size === 0) await this.releaseHook();
      return this.client.resume();
    });
  }
  /** Interrupt a running source step and return the paused snapshot. */
  pause(): Promise<DebugSnapshot> {
    if (this.disposed) return Promise.reject(new DebugSessionError('Debug session is disposed'));
    // A source step may be waiting for a ROM statement hook inside the command queue.
    // Pause must reach the emulator without waiting for that command to finish.
    this.pauseSequence++;
    return this.lastPause = this.client.pause().then(state => this.snapshotFromState(state));
  }
  /** Reset the emulator and inspect its current BASIC line. */
  reset(): Promise<DebugSnapshot> {
    return this.command(async () => { await this.client.reset(); return this.snapshotFromState(await this.client.executionState()); });
  }
  /** Execute the project load plan and start BASIC. */
  launch(plan: LoadPlan, options: LaunchLoadPlanOptions = {}): Promise<ExecutionState> {
    return this.command(() => this.client.launchLoadPlan(plan, options));
  }

  /** Advance to the next effective numbered BASIC line. */
  stepIn(options: BasicSourceStepOptions = {}): Promise<SourceStepResult> { return this.stepLine(options); }
  /** Advance to the next effective numbered BASIC line. */
  next(options: BasicSourceStepOptions = {}): Promise<SourceStepResult> { return this.stepLine(options); }

  /** Execute one machine instruction within the supplied cycle budget. */
  stepInstruction(maxCycles = 10000): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.stepInstruction(maxCycles)));
  }

  /** Read CPU-mapped memory, preserving unreadable bytes as null. */
  readMemory(address: number, count: number) { return this.command(() => this.client.readMemory(address, count)); }

  /** Decode the ROM's live simple-variable table. */
  variables(): Promise<BasicRuntimeVariable[]> {
    return this.command(() => readBasicVariables(this.client));
  }

  /** Look up a simple variable by its first two significant name characters. */
  async evaluate(expression: string): Promise<BasicRuntimeVariable | undefined> {
    if (typeof expression !== 'string') throw new TypeError('expression must be a string');
    const normalized = expression.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]*[$%]?$/u.test(normalized)) return undefined;
    const suffix = normalized.endsWith('$') || normalized.endsWith('%') ? normalized.at(-1)! : '';
    const significant = normalized.slice(0, suffix ? -1 : undefined).slice(0, 2) + suffix;
    return (await this.variables()).find(variable => variable.name === significant);
  }

  /** Replace requested physical source lines for this BASIC file. */
  setSourceBreakpoints(path: string, physicalLines: readonly number[]): Promise<DebugBreakpoint[]> {
    return this.command(async () => {
      if (!Array.isArray(physicalLines) || physicalLines.some(line => !Number.isInteger(line) || line < 1)) throw new RangeError('lines must contain positive integers');
      const sameSource = this.matchesPath(path);
      this.requestedLines.clear();
      const resolved = physicalLines.map(line => {
        const number = sameSource ? this.numberByPhysical.get(line) : undefined;
        if (number !== undefined) this.requestedLines.add(number);
        return number === undefined
          ? {path, requestedLine: line, verified: false, addresses: [], message: 'No effective BASIC statement at this line'}
          : {path, requestedLine: line, verified: true, line, addresses: [basicRuntimeDebug.lineStartAddress]};
      });
      if (this.requestedLines.size) { await this.ensureHook(); await this.applyFilter(); }
      else await this.releaseHook();
      return resolved;
    });
  }

  /** Remove requested lines and release an owned statement hook. */
  clearSourceBreakpoints(): Promise<void> {
    return this.command(async () => { this.requestedLines.clear(); await this.releaseHook(); });
  }

  /** Poll for a stop, skipping statement hooks for unrequested BASIC lines. */
  async waitForStop(options: WaitForStopOptions): Promise<DebugSnapshot> {
    const interval = stopWaitInterval(options);
    const deadline = Date.now() + options.timeoutMs;
    for (;;) {
      if (options.signal?.aborted) throw new DebugSessionError('Stop wait aborted');
      const state = await this.client.executionState();
      if (!state.running) {
        if (!await this.isRequestedStop(state)) {
          if (Date.now() >= deadline) throw new DebugSessionError('Timed out waiting for emulator to stop');
          await this.client.resume();
          continue;
        }
        return this.snapshotFromState(state);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DebugSessionError('Timed out waiting for emulator to stop');
      await waitForPoll(Math.min(interval, remaining), options.signal, () => new DebugSessionError('Stop wait aborted'));
    }
  }

  /** Stop a pending step and release the statement hook owned by this session. */
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    if (this.disposed) return this.commands.idle;
    this.disposing = (async () => {
      // Stop an in-flight source step before queuing hook cleanup.
      await this.pause().catch(() => undefined);
      await this.command(async () => {
        this.requestedLines.clear();
        await this.releaseHook();
        this.disposed = true;
      }, true);
    })();
    return this.disposing;
  }

  /** Run until a different BASIC line, a machine stop, or a host limit. */
  private stepLine(options: BasicSourceStepOptions): Promise<SourceStepResult> {
    const sequence = this.pauseSequence;
    return this.command(async () => {
      const limit = options.maxInstructions ?? 10000;
      const timeoutMs = options.timeoutMs ?? 30000;
      const pollIntervalMs = options.pollIntervalMs ?? 10;
      if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 1
        || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) throw new RangeError('Invalid BASIC source-step limits');
      const deadline = Date.now() + timeoutMs;
      await this.ensureHook();
      // A step stops at the next line start, whatever line it is; the filter comes back afterwards.
      await this.clearFilter();
      try {
        return await this.stepLines(sequence, limit, deadline, pollIntervalMs);
      } finally {
        await this.applyFilter();
      }
    });
  }

  /** Resume statement by statement until the BASIC line changes. */
  private async stepLines(sequence: number, limit: number, deadline: number, pollIntervalMs: number): Promise<SourceStepResult> {
    const startState = await this.client.executionState();
    const startLine = await this.currentLine();
    const startLocation = this.location(startLine);
    let state = startState;
    for (let statements = 1; statements <= limit; statements++) {
      state = await this.resumeToStop(sequence, deadline, pollIntervalMs);
      if (sequence !== this.pauseSequence) {
        state = (await this.lastPause!).state;
        return this.stepResult(state, 'stopped', statements, startLocation);
      }
      if (state.stopReason !== 'breakpoint' || state.pc !== basicRuntimeDebug.lineStartAddress) {
        const reason = state.stopReason === 'cpu-stopped' ? 'cpu-stopped' : state.stopReason === 'mia-paused' ? 'mia-paused' : 'stopped';
        return this.stepResult(state, reason, statements, startLocation);
      }
      // The hook runs only when a numbered line starts, before it runs, so the
      // first stop is the next line, even when it is the same line again (a loop).
      const current = this.location(await this.currentLine());
      return this.stepResult(state, current ? 'source-location' : 'unmapped', statements, startLocation, current);
    }
    const current = this.location(await this.currentLine());
    return this.stepResult(state, 'instruction-limit', limit, startLocation, current);
  }

  /**
   * Run to the next BASIC statement, whatever its line, as after leaving an
   * assembly routine. Stops early on any other breakpoint or machine stop.
   */
  runToNextStatement(options: BasicSourceStepOptions = {}): Promise<SourceStepResult> {
    const sequence = this.pauseSequence;
    return this.command(async () => {
      const deadline = Date.now() + (options.timeoutMs ?? 30000);
      await this.ensureHook();
      await this.clearFilter();
      try {
        const state = await this.resumeToStop(sequence, deadline, options.pollIntervalMs ?? 10);
        const atStatement = state.stopReason === 'breakpoint' && state.pc === basicRuntimeDebug.lineStartAddress;
        const current = atStatement ? this.location(await this.currentLine()) : undefined;
        return this.stepResult(state, current ? 'source-location' : 'stopped', 1, undefined, current);
      } finally {
        if (this.requestedLines.size) await this.applyFilter();
        else await this.releaseHook();
      }
    });
  }

  /**
   * False for a statement-hook stop on a line nobody asked to stop on, which
   * the caller should resume. True for every other stop.
   */
  async isRequestedStop(state: ExecutionState): Promise<boolean> {
    if (state.stopReason !== 'breakpoint' || state.pc !== basicRuntimeDebug.lineStartAddress || !this.requestedLines.size) return true;
    return this.requestedLines.has(await this.currentLine());
  }

  /** Whether this session has BASIC line breakpoints. */
  hasLineBreakpoints(): boolean { return this.requestedLines.size > 0; }

  /** Whether a breakpoint path names the BASIC source this session debugs. */
  matchesPath(path: string): boolean {
    const normalized = path.replaceAll('\\', '/');
    return [this.sourcePath, ...this.aliases].some(candidate => candidate.replaceAll('\\', '/') === normalized);
  }

  /** Construct the source-step result shared by each stop condition. */
  private stepResult(
    state: ExecutionState,
    reason: SourceStepResult['reason'],
    instructions: number,
    start?: SourceStepLocation,
    current?: SourceStepLocation,
  ): SourceStepResult {
    return {
      state, reason, instructions,
      startLocations: start ? [start] : [],
      locations: current ? [current] : [],
      steppedOverCall: false,
    };
  }

  /** Resume once and poll until the hook, a machine stop, or an external pause. */
  private async resumeToStop(sequence: number, deadline: number, pollIntervalMs: number): Promise<ExecutionState> {
    if (sequence !== this.pauseSequence) return (await this.lastPause!).state;
    let state = await this.client.resume();
    while (state.running) {
      if (sequence !== this.pauseSequence) return (await this.lastPause!).state;
      if (Date.now() >= deadline) {
        await this.pause();
        throw new DebugSessionError('Timed out waiting for a BASIC statement boundary');
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now())));
      state = await this.client.executionState();
    }
    return state;
  }

  /** Install the ROM statement breakpoint unless another client already owns it. */
  private async ensureHook(): Promise<void> {
    if (this.hookOwned) return;
    const active = await this.client.breakpoints();
    if (!active.includes(basicRuntimeDebug.lineStartAddress)) {
      await this.client.addBreakpoint(basicRuntimeDebug.lineStartAddress);
      this.hookOwned = true;
    }
  }

  /** Let the emulator skip statement hooks on other lines, when it can. */
  private async applyFilter(): Promise<void> {
    if (!this.hookOwned || !this.requestedLines.size) return this.clearFilter();
    // An emulator without the method, or one that cannot list its methods, filters here instead.
    this.filterSupported ??= await this.client.capabilities()
      .then(capabilities => capabilities.methods.includes('setBreakpointFilter'), () => false);
    if (!this.filterSupported) return;
    await this.client.setBreakpointFilter(basicRuntimeDebug.lineStartAddress, basicRuntimeDebug.currentLineAddress, [...this.requestedLines]);
    this.filtered = true;
  }

  /** Remove this session's line filter so the hook stops on every statement. */
  private async clearFilter(): Promise<void> {
    if (!this.filtered) return;
    await this.client.clearBreakpointFilter(basicRuntimeDebug.lineStartAddress);
    this.filtered = false;
  }

  /** Remove the ROM statement breakpoint only if this session installed it. */
  private async releaseHook(): Promise<void> {
    await this.clearFilter();
    if (!this.hookOwned) return;
    await this.client.removeBreakpoint(basicRuntimeDebug.lineStartAddress);
    this.hookOwned = false;
  }

  /** Read CURLIN as a little-endian BASIC line number. */
  private async currentLine(): Promise<number> {
    const bytes = await this.client.readMemory(basicRuntimeDebug.currentLineAddress, 2);
    if (bytes[0] === null || bytes[1] === null) throw new DebugSessionError('CURLIN is not readable');
    return bytes[0]! | (bytes[1]! << 8);
  }

  /** Map a BASIC line number to its current physical source line. */
  private location(number: number) {
    const line = this.lineByNumber.get(number);
    return line && {path: this.sourcePath, line: line.physicalLine, address: basicRuntimeDebug.lineStartAddress};
  }

  /** Combine emulator state with the current BASIC source location. */
  async snapshotFromState(state: ExecutionState): Promise<DebugSnapshot> {
    const number = await this.currentLine();
    const location = this.location(number);
    return {
      state,
      thread: {id: 1, name: this.threadName},
      frame: {
        id: 1, threadId: 1,
        name: location ? `${sourceName(this.sourcePath)}:${location.line}` : cpuAddressLabel(state.pc),
        instructionPointer: state.pc,
        ...(location ? {source: {path: location.path, line: location.line}, locations: [location]} : {locations: []}),
      },
      registers: {pc: state.pc, a: state.a, x: state.x, y: state.y, sp: state.sp, p: state.p, cycles: state.cycles, miaPaused: state.paused},
    };
  }

  /** Serialize editor commands while allowing pause to bypass the queue. */
  private command<T>(operation: () => Promise<T>, allowDisposed = false): Promise<T> {
    return this.commands.run(() => {
      if (this.disposed && !allowDisposed) throw new DebugSessionError('Debug session is disposed');
      return operation();
    });
  }
}
