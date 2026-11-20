import type {ExecutionState, LaunchLoadPlanOptions, SourceStepOptions, SourceStepResult} from '@clementina/emulator-client';
import type {LoadPlan} from '@clementina/basic';
import {SerialQueue} from '@clementina/core';
import {ClementinaBasicDebugSession, type BasicRuntimeVariable, type BasicSourceStepOptions} from './basic.js';
import {stopWaitInterval, waitForPoll} from './polling.js';
import {DebugSessionError} from './errors.js';
import {registerName, type DebugEvaluation} from './assembly-evaluate.js';
import type {ClementinaDebugSession, DebugBreakpoint, DebugInstruction, DebugSnapshot, DebugStack, WaitForStopOptions} from './index.js';

/**
 * Debugger for a project with both a BASIC program and assembly routines, as
 * every `clementina new` project has. BASIC lines and assembly lines take
 * breakpoints at once. A stop is shown in whichever source holds the program
 * counter: assembly when it is in a mapped routine, BASIC otherwise.
 */
export class ClementinaProjectDebugSession {
  private readonly commands = new SerialQueue();
  private disposed = false;

  /** Combine sessions that share one emulator client. */
  constructor(
    private readonly basic: ClementinaBasicDebugSession,
    private readonly assembly: ClementinaDebugSession,
    private readonly threadName = 'Clementina 65C02',
  ) {}

  /** Return the single CPU thread presented to editor clients. */
  threads(): readonly [{id: number; name: string}] { return [{id: 1, name: this.threadName}]; }

  /** Read execution state and describe it in BASIC or assembly terms. */
  async snapshot(): Promise<DebugSnapshot> {
    const assembly = await this.assembly.snapshot();
    return this.inAssembly(assembly) ? this.named(assembly) : this.named(await this.basic.snapshotFromState(assembly.state));
  }

  /** Assembly frames with their verified callers, under the BASIC line that called them. */
  async stackTrace(): Promise<DebugStack> {
    const leaf = await this.assembly.snapshot();
    if (!this.inAssembly(leaf)) return {frames: [(await this.basic.snapshotFromState(leaf.state)).frame], unknownCaller: false};
    const stack = await this.assembly.stackTrace();
    const basic = (await this.basic.snapshotFromState(leaf.state)).frame;
    if (!basic.source) return stack;
    return {frames: [...stack.frames, {...basic, id: stack.frames.length + 1, name: `${basic.name} (BASIC)`}], unknownCaller: false};
  }

  /** Resume; BASIC keeps its statement hook only while it has line breakpoints. */
  continue(): Promise<ExecutionState> { return this.basic.continue(); }
  /** Stop execution and return the paused snapshot. */
  async pause(): Promise<DebugSnapshot> { await this.basic.pause(); return this.snapshot(); }
  /** Reset the machine. */
  async reset(): Promise<DebugSnapshot> { await this.basic.reset(); return this.snapshot(); }
  /** Execute the project load plan and start BASIC. */
  launch(plan: LoadPlan, options: LaunchLoadPlanOptions = {}): Promise<ExecutionState> { return this.basic.launch(plan, options); }

  /** Step into the next source line of whichever language is running. */
  stepIn(options: SourceStepOptions & BasicSourceStepOptions = {}): Promise<SourceStepResult> { return this.step('stepIn', options); }
  /** Step over the next source line of whichever language is running. */
  next(options: SourceStepOptions & BasicSourceStepOptions = {}): Promise<SourceStepResult> { return this.step('next', options); }

  /** Execute one machine instruction. */
  stepInstruction(maxCycles = 10000): Promise<DebugSnapshot> {
    return this.command(async () => { await this.assembly.stepInstruction(maxCycles); return this.snapshot(); });
  }

  /** Read CPU-mapped memory. */
  readMemory(address: number, count: number): Promise<(number | null)[]> { return this.assembly.readMemory(address, count); }
  /** Decode instructions from stopped memory, with assembly source lines. */
  disassemble(address: number, count: number, bank?: number): Promise<DebugInstruction[]> { return this.assembly.disassemble(address, count, bank); }
  /** Decode BASIC's simple variables. */
  variables(): Promise<BasicRuntimeVariable[]> { return this.basic.variables(); }
  /**
   * Look up a name in the language being hovered: `language` comes from the
   * hovered file, and without it from where the program is stopped. A name
   * the first language doesn't know is tried in the other one, so `A` is the
   * register in assembly and the variable in BASIC.
   */
  async evaluate(expression: string, language?: 'basic' | 'assembly'): Promise<DebugEvaluation | undefined> {
    const assemblyFirst = language ? language === 'assembly' : this.inAssembly(await this.assembly.snapshot());
    // In BASIC, A is the variable even when it isn't set yet, never the register.
    const order = assemblyFirst ? [this.assembly, this.basic] as const
      : registerName(expression) ? [this.basic] as const : [this.basic, this.assembly] as const;
    for (const session of order) {
      const value = await session.evaluate(expression);
      if (value) return value;
    }
    return undefined;
  }

  /** Send BASIC source lines to the BASIC session and every other file to assembly. */
  setSourceBreakpoints(path: string, lines: readonly number[]): Promise<DebugBreakpoint[]> {
    return this.command(() => this.isBasicPath(path) ? this.basic.setSourceBreakpoints(path, lines) : this.assembly.setSourceBreakpoints(path, lines));
  }

  /** Remove every breakpoint either session installed. */
  clearSourceBreakpoints(): Promise<void> {
    return this.command(async () => { await this.basic.clearSourceBreakpoints(); await this.assembly.clearSourceBreakpoints(); });
  }

  /** Poll until a stop someone asked for, resuming over other BASIC lines. */
  async waitForStop(options: WaitForStopOptions): Promise<DebugSnapshot> {
    if (this.disposed) throw new DebugSessionError('Debug session is disposed');
    const interval = stopWaitInterval(options);
    const deadline = Date.now() + options.timeoutMs;
    for (;;) {
      if (options.signal?.aborted) throw new DebugSessionError('Stop wait aborted');
      const snapshot = await this.assembly.snapshot();
      if (!snapshot.state.running) {
        // An assembly breakpoint always counts; a statement hook counts on requested lines.
        if (this.inAssembly(snapshot) || await this.basic.isRequestedStop(snapshot.state)) return this.snapshot();
        if (Date.now() >= deadline) throw new DebugSessionError('Timed out waiting for emulator to stop');
        await this.basic.continue();
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DebugSessionError('Timed out waiting for emulator to stop');
      await waitForPoll(Math.min(interval, remaining), options.signal, () => new DebugSessionError('Stop wait aborted'));
    }
  }

  /** Release both sessions' breakpoints. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.basic.dispose().catch(() => undefined);
    await this.assembly.dispose().catch(() => undefined);
  }

  /** Step in assembly while in a routine, and in BASIC lines otherwise. */
  private step(command: 'next' | 'stepIn', options: SourceStepOptions & BasicSourceStepOptions): Promise<SourceStepResult> {
    return this.command(async () => {
      const start = await this.assembly.snapshot();
      if (!this.inAssembly(start)) return this.basic[command](options);
      const stepped = await this.assembly[command](options);
      // Returning from the routine lands in the ROM: carry on to the BASIC statement after the call.
      if (stepped.reason === 'unmapped' && stepped.locations.length === 0) return this.basic.runToNextStatement(options);
      return stepped;
    });
  }

  /** Whether the program counter is in a mapped assembly source line. */
  private inAssembly(snapshot: DebugSnapshot): boolean { return snapshot.frame.locations.length > 0; }

  /** Use the combined thread name. */
  private named(snapshot: DebugSnapshot): DebugSnapshot { return {...snapshot, thread: {...snapshot.thread, name: this.threadName}}; }

  /** Whether a breakpoint path is the BASIC entry program. */
  private isBasicPath(path: string): boolean { return this.basic.matchesPath(path); }

  /** Serialize editor commands. */
  private command<T>(operation: () => Promise<T>): Promise<T> {
    return this.commands.run(() => {
      if (this.disposed) throw new DebugSessionError('Debug session is disposed');
      return operation();
    });
  }
}
