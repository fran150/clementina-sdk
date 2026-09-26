import {basename} from 'node:path';
import {basicRuntimeDebug, parseBasicSource, type LoadPlan} from '@clementina/basic';
import {
  type EmulatorClient,
  type ExecutionState,
  type LaunchLoadPlanOptions,
  type SourceStepOptions,
  type SourceStepResult,
} from '@clementina/emulator-client';
import type {DebugBreakpoint, DebugSnapshot, WaitForStopOptions} from './index.js';

interface BasicLineLocation {number: number; physicalLine: number}
export interface BasicRuntimeVariable {name: string; value: string; type: 'number' | 'integer' | 'string' | 'array'}

function effectiveLines(source: string): BasicLineLocation[] {
  parseBasicSource(source);
  const effective = new Map<number, number>();
  source.replace(/\r\n?/gu, '\n').split('\n').forEach((raw, index) => {
    const match = /^\s*([0-9]+)(.*)$/u.exec(raw);
    if (!match) return;
    const number = Number(match[1]);
    const body = match[2]!.replace(/^ +/u, '');
    if (body === '') effective.delete(number);
    else effective.set(number, index + 1);
  });
  return [...effective].map(([number, physicalLine]) => ({number, physicalLine})).sort((a, b) => a.number - b.number);
}

/** BASIC source debugger using the ROM's NEWSTT2 statement hook and CURLIN. */
export class ClementinaBasicDebugSession {
  private readonly lines: BasicLineLocation[];
  private readonly lineByNumber: Map<number, BasicLineLocation>;
  private readonly numberByPhysical: Map<number, number>;
  private readonly requestedLines = new Set<number>();
  private hookOwned = false;
  private disposed = false;
  private commandTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: EmulatorClient,
    private readonly sourcePath: string,
    source: string,
    private readonly threadName = 'Clementina BASIC',
  ) {
    if (!sourcePath) throw new TypeError('sourcePath must not be empty');
    this.lines = effectiveLines(source);
    this.lineByNumber = new Map(this.lines.map(line => [line.number, line]));
    this.numberByPhysical = new Map(this.lines.map(line => [line.physicalLine, line.number]));
  }

  threads() { return [{id: 1, name: this.threadName}] as const; }

  snapshot(): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.executionState()));
  }

  continue(): Promise<ExecutionState> {
    return this.command(async () => {
      if (this.requestedLines.size === 0) await this.releaseHook();
      return this.client.resume();
    });
  }
  pause(): Promise<DebugSnapshot> { return this.command(async () => this.snapshotFromState(await this.client.pause())); }
  reset(): Promise<DebugSnapshot> {
    return this.command(async () => { await this.client.reset(); return this.snapshotFromState(await this.client.executionState()); });
  }
  launch(plan: LoadPlan, options: LaunchLoadPlanOptions = {}): Promise<ExecutionState> {
    return this.command(() => this.client.launchLoadPlan(plan, options));
  }

  stepIn(options: SourceStepOptions = {}): Promise<SourceStepResult> { return this.stepLine(options); }
  next(options: SourceStepOptions = {}): Promise<SourceStepResult> { return this.stepLine(options); }

  stepInstruction(maxCycles = 10000): Promise<DebugSnapshot> {
    return this.command(async () => this.snapshotFromState(await this.client.stepInstruction(maxCycles)));
  }

  readMemory(address: number, count: number) { return this.command(() => this.client.readMemory(address, count)); }

  variables(): Promise<BasicRuntimeVariable[]> {
    return this.command(async () => {
      const pointers = await this.bytes(0x007c, 4);
      const vartab = pointers[0]! | (pointers[1]! << 8), arytab = pointers[2]! | (pointers[3]! << 8);
      if (arytab < vartab || (arytab - vartab) % 7 !== 0) throw new Error('Invalid BASIC variable table bounds');
      const variables: BasicRuntimeVariable[] = [];
      for (let address = vartab; address < arytab; address += 7) {
        const record = await this.bytes(address, 7);
        const name = this.variableName(record[0]!, record[1]!);
        const string = (record[1]! & 0x80) !== 0, integer = !string && (record[0]! & 0x80) !== 0;
        if (string) {
          const length = record[2]!, pointer = record[3]! | (record[4]! << 8);
          const value = length === 0 ? '' : String.fromCharCode(...await this.bytes(pointer, length));
          variables.push({name, value: JSON.stringify(value), type: 'string'});
        } else if (integer) {
          const unsigned = (record[2]! << 8) | record[3]!;
          variables.push({name, value: String(unsigned & 0x8000 ? unsigned - 0x10000 : unsigned), type: 'integer'});
        } else {
          variables.push({name, value: String(this.decodeFloat(record.slice(2, 7))), type: 'number'});
        }
      }
      return variables.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async evaluate(expression: string): Promise<BasicRuntimeVariable | undefined> {
    if (typeof expression !== 'string') throw new TypeError('expression must be a string');
    const normalized = expression.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]*[$%]?$/u.test(normalized)) return undefined;
    const significant = normalized.slice(0, normalized.endsWith('$') || normalized.endsWith('%') ? Math.min(2, normalized.length - 1) : Math.min(2, normalized.length))
      + (normalized.endsWith('$') || normalized.endsWith('%') ? normalized.at(-1)! : '');
    return (await this.variables()).find(variable => variable.name === significant);
  }

  setSourceBreakpoints(path: string, physicalLines: readonly number[]): Promise<DebugBreakpoint[]> {
    return this.command(async () => {
      if (!Array.isArray(physicalLines) || physicalLines.some(line => !Number.isInteger(line) || line < 1)) throw new RangeError('lines must contain positive integers');
      const sameSource = path.replaceAll('\\', '/') === this.sourcePath.replaceAll('\\', '/');
      this.requestedLines.clear();
      const resolved = physicalLines.map(line => {
        const number = sameSource ? this.numberByPhysical.get(line) : undefined;
        if (number !== undefined) this.requestedLines.add(number);
        return number === undefined
          ? {path, requestedLine: line, verified: false, addresses: [], message: 'No effective BASIC statement at this line'}
          : {path, requestedLine: line, verified: true, line, addresses: [basicRuntimeDebug.statementBoundaryAddress]};
      });
      if (this.requestedLines.size) await this.ensureHook();
      else await this.releaseHook();
      return resolved;
    });
  }

  clearSourceBreakpoints(): Promise<void> {
    return this.command(async () => { this.requestedLines.clear(); await this.releaseHook(); });
  }

  async waitForStop(options: WaitForStopOptions): Promise<DebugSnapshot> {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new RangeError('timeoutMs must be a positive integer');
    const interval = options.pollIntervalMs ?? 10;
    const deadline = Date.now() + options.timeoutMs;
    for (;;) {
      if (options.signal?.aborted) throw new Error('Stop wait aborted');
      const state = await this.client.executionState();
      if (!state.running) {
        if (state.stopReason === 'breakpoint' && state.pc === basicRuntimeDebug.statementBoundaryAddress && this.requestedLines.size) {
          const number = await this.currentLine();
          if (!this.requestedLines.has(number)) { await this.client.resume(); continue; }
        }
        return this.snapshotFromState(state);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for emulator to stop');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(interval, remaining));
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Stop wait aborted')); }, {once: true});
      });
    }
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.commandTail;
    return this.command(async () => {
      this.requestedLines.clear();
      await this.releaseHook();
      this.disposed = true;
    }, true);
  }

  private stepLine(options: SourceStepOptions): Promise<SourceStepResult> {
    return this.command(async () => {
      await this.ensureHook();
      const startState = await this.client.executionState();
      const startLine = await this.currentLine();
      const startLocation = this.location(startLine);
      const limit = options.maxInstructions ?? 10000;
      let state = startState;
      for (let statements = 1; statements <= limit; statements++) {
        state = await this.client.resume();
        while (state.running) state = await this.client.executionState();
        if (state.stopReason !== 'breakpoint' || state.pc !== basicRuntimeDebug.statementBoundaryAddress) {
          return {state, reason: state.stopReason === 'cpu-stopped' ? 'cpu-stopped' : state.stopReason === 'mia-paused' ? 'mia-paused' : 'stopped', instructions: statements, startLocations: startLocation ? [startLocation] : [], locations: [], steppedOverCall: false};
        }
        const currentLine = await this.currentLine();
        if (currentLine !== startLine) {
          const current = this.location(currentLine);
          return {state, reason: current ? 'source-location' : 'unmapped', instructions: statements, startLocations: startLocation ? [startLocation] : [], locations: current ? [current] : [], steppedOverCall: false};
        }
      }
      const current = this.location(await this.currentLine());
      return {state, reason: 'instruction-limit', instructions: limit, startLocations: startLocation ? [startLocation] : [], locations: current ? [current] : [], steppedOverCall: false};
    });
  }

  private async ensureHook(): Promise<void> {
    if (this.hookOwned) return;
    const active = await this.client.breakpoints();
    if (!active.includes(basicRuntimeDebug.statementBoundaryAddress)) {
      await this.client.addBreakpoint(basicRuntimeDebug.statementBoundaryAddress);
      this.hookOwned = true;
    }
  }

  private async releaseHook(): Promise<void> {
    if (!this.hookOwned) return;
    await this.client.removeBreakpoint(basicRuntimeDebug.statementBoundaryAddress);
    this.hookOwned = false;
  }

  private async currentLine(): Promise<number> {
    const bytes = await this.client.readMemory(basicRuntimeDebug.currentLineAddress, 2);
    if (bytes[0] === null || bytes[1] === null) throw new Error('CURLIN is not readable');
    return bytes[0]! | (bytes[1]! << 8);
  }

  private async bytes(address: number, count: number): Promise<number[]> {
    const bytes = await this.client.readMemory(address, count);
    if (bytes.some(byte => byte === null)) throw new Error(`BASIC memory at $${address.toString(16).toUpperCase()} is not readable`);
    return bytes as number[];
  }

  private variableName(first: number, second: number): string {
    let name = String.fromCharCode(first & 0x7f);
    if ((second & 0x7f) !== 0) name += String.fromCharCode(second & 0x7f);
    if (second & 0x80) name += '$';
    else if (first & 0x80) name += '%';
    return name;
  }

  private decodeFloat(bytes: number[]): number {
    const exponent = bytes[0]!;
    if (exponent === 0) return 0;
    const negative = (bytes[1]! & 0x80) !== 0;
    const fraction = (((bytes[1]! & 0x7f) * 0x1000000) + (bytes[2]! * 0x10000) + (bytes[3]! * 0x100) + bytes[4]!) / 0x80000000;
    const value = (1 + fraction) * 2 ** (exponent - 129);
    return negative ? -value : value;
  }

  private location(number: number) {
    const line = this.lineByNumber.get(number);
    return line && {path: this.sourcePath, line: line.physicalLine, address: basicRuntimeDebug.statementBoundaryAddress};
  }

  private async snapshotFromState(state: ExecutionState): Promise<DebugSnapshot> {
    const number = await this.currentLine();
    const location = this.location(number);
    return {
      state,
      thread: {id: 1, name: this.threadName},
      frame: {
        id: 1, threadId: 1,
        name: location ? `${basename(this.sourcePath)}:${location.line}` : `$${state.pc.toString(16).toUpperCase().padStart(4, '0')}`,
        instructionPointer: state.pc,
        ...(location ? {source: {path: location.path, line: location.line}, locations: [location]} : {locations: []}),
      },
      registers: {pc: state.pc, a: state.a, x: state.x, y: state.y, sp: state.sp, p: state.p, cycles: state.cycles, miaPaused: state.paused},
    };
  }

  private command<T>(operation: () => Promise<T>, allowDisposed = false): Promise<T> {
    const result = this.commandTail.then(async () => {
      if (this.disposed && !allowDisposed) throw new Error('Debug session is disposed');
      return operation();
    });
    this.commandTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
