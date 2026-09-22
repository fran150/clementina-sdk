import {renderBootstrapSource, type LoadPlan} from '@clementina/basic';

/** Version 1 headless emulator automation. No Studio or Node runtime dependency. */
export interface EmulatorState {
  cycles: string; pc: number; a: number; x: number; y: number;
  sp: number; p: number; paused: boolean;
  /** Present when the server advertises execution-control methods. */
  running?: boolean; stopReason?: StopReason; instructionBoundary?: boolean;
}
export type StopReason = 'initial' | 'running' | 'pause' | 'reset' | 'breakpoint' | 'instruction' | 'cycle-limit' | 'mia-paused' | 'cpu-stopped';
export interface ExecutionState extends EmulatorState {
  running: boolean; stopReason: StopReason; instructionBoundary: boolean;
}
const stopReasons: readonly string[] = ['initial','running','pause','reset','breakpoint','instruction','cycle-limit','mia-paused','cpu-stopped'];
export interface EmulatorCapabilities {
  version: 1; methods: string[]; maxCycles: number; maxRead: number;
}
export class EmulatorError extends Error {}
export type EmulatorTransport = (request: Record<string, unknown>) => Promise<unknown>;
export interface LaunchLoadPlanOptions {
  /** Existing ROM test budget for reaching the BASIC editor, not a readiness guarantee. */
  bootCycles?: number;
  /** Cycle budget after each input chunk while the ROM editor/tokenizer consumes it. */
  inputCycles?: number;
  /** Raw input chunk size; must fit the MIA's 64-byte text FIFO. */
  inputChunkBytes?: number;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const integer = (v: unknown, max: number): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max;
function state(v: unknown): v is EmulatorState {
  return object(v) && typeof v.cycles === 'string' && /^(0|[1-9][0-9]*)$/.test(v.cycles)
    && integer(v.pc, 65535) && ['a','x','y','sp','p'].every(k => integer(v[k],255)) && typeof v.paused === 'boolean'
    && (v.running === undefined || typeof v.running === 'boolean')
    && (v.instructionBoundary === undefined || typeof v.instructionBoundary === 'boolean')
    && (v.stopReason === undefined || (typeof v.stopReason === 'string' && stopReasons.includes(v.stopReason)));
}
function executionState(v: unknown): v is ExecutionState {
  return state(v) && typeof v.running === 'boolean' && typeof v.instructionBoundary === 'boolean' && v.stopReason !== undefined;
}
function addresses(v: unknown): v is number[] {
  return Array.isArray(v) && v.every(n => integer(n,65535)) && new Set(v).size === v.length;
}
/** Requests are never retried: a lost response may follow a completed mutation. */
export class EmulatorClient {
  constructor(private readonly transport: EmulatorTransport) {}
  private async call<T>(method: string, params: Record<string, unknown>, check: (v: unknown) => v is T): Promise<T> {
    const response = await this.transport({version: 1, method, ...params});
    if (!object(response) || response.version !== 1 || typeof response.ok !== 'boolean') throw new EmulatorError('Invalid protocol response');
    if (!response.ok) {
      if (typeof response.error !== 'string') throw new EmulatorError('Invalid protocol error');
      throw new EmulatorError(response.error);
    }
    if (!check(response.result)) throw new EmulatorError(`Invalid ${method} result`);
    return response.result;
  }
  capabilities(): Promise<EmulatorCapabilities> {
    return this.call('capabilities', {}, (v): v is EmulatorCapabilities => object(v) && v.version === 1
      && Array.isArray(v.methods) && v.methods.every(m => typeof m === 'string')
      && integer(v.maxCycles, Number.MAX_SAFE_INTEGER) && Number(v.maxCycles)>0
      && integer(v.maxRead,65536) && Number(v.maxRead)>0);
  }
  state() { return this.call('state', {}, state); }
  reset() { return this.call('reset', {}, state); }
  step(count: number) {
    if (!integer(count,10000000) || count === 0) throw new RangeError('count must be 1..10000000');
    return this.call('step', {count}, state);
  }
  /** Starts unthrottled background execution; returns before it stops. */
  run() { return this.call('run', {}, executionState); }
  /** Waits for ownership of the machine, then stops at a complete cycle boundary. */
  pause() { return this.call('pause', {}, executionState); }
  /** Clears MIA execution pause and skips a just-hit breakpoint once. */
  resume() { return this.call('resume', {}, executionState); }
  /** Advances to the next opcode boundary, or reports why it stopped first. */
  stepInstruction(maxCycles = 10000) {
    if (!integer(maxCycles,10000000) || maxCycles === 0) throw new RangeError('maxCycles must be 1..10000000');
    return this.call('stepInstruction', {count:maxCycles}, executionState);
  }
  addBreakpoint(address: number) {
    if (!integer(address,65535)) throw new RangeError('Invalid breakpoint address');
    return this.call('addBreakpoint', {address}, addresses);
  }
  removeBreakpoint(address: number) {
    if (!integer(address,65535)) throw new RangeError('Invalid breakpoint address');
    return this.call('removeBreakpoint', {address}, addresses);
  }
  breakpoints() { return this.call('breakpoints', {}, addresses); }
  clearBreakpoints() { return this.call('clearBreakpoints', {}, addresses); }
  readMemory(address: number, count: number) {
    if (!integer(address,65535) || !integer(count,65536-address) || count===0) throw new RangeError('Invalid CPU memory range');
    return this.call('readMemory', {address,count}, (v): v is (number|null)[] => Array.isArray(v) && v.length===count && v.every(b => b===null || integer(b,255)));
  }
  input(data: readonly number[]) {
    if (!Array.isArray(data) || data.length<1 || data.length>64 || !Array.from(data).every(b=>integer(b,255))) throw new RangeError('input must contain 1..64 bytes');
    return this.call('input', {data:Array.from(data)}, state);
  }
  video() {
    return this.call('video', {}, (v): v is number[] => Array.isArray(v) && v.length===68944 && v.every(b=>integer(b,255)));
  }
  /**
   * Reset, boot the ROM, enter a generated BASIC bootstrap through the real
   * tokenizer, and start it. The automation server must have the build output
   * mounted as its SD root. Address breakpoints become active when RUN begins.
   */
  async launchLoadPlan(plan: LoadPlan, options: LaunchLoadPlanOptions = {}): Promise<ExecutionState> {
    const source = renderBootstrapSource(plan);
    const bootCycles = options.bootCycles ?? 4_000_000;
    const inputCycles = options.inputCycles ?? 200_000;
    const chunkBytes = options.inputChunkBytes ?? 48;
    if (!integer(bootCycles, 10_000_000) || bootCycles === 0) throw new RangeError('bootCycles must be 1..10000000');
    if (!integer(inputCycles, 10_000_000) || inputCycles === 0) throw new RangeError('inputCycles must be 1..10000000');
    if (!integer(chunkBytes, 64) || chunkBytes === 0) throw new RangeError('inputChunkBytes must be 1..64');

    await this.reset();
    await this.step(bootCycles);
    for (const line of source.trimEnd().split('\n')) await this.enterBasicLine(line, inputCycles, chunkBytes);
    await this.enterBasicLine('RUN', 0, chunkBytes);
    return this.run();
  }

  private async enterBasicLine(line: string, inputCycles: number, chunkBytes: number): Promise<void> {
    const bytes = Array.from(line, character => character.charCodeAt(0));
    if (bytes.some(byte => byte > 0x7f)) throw new TypeError('BASIC bootstrap must contain ASCII only');
    bytes.push(13);
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      await this.input(bytes.slice(offset, offset + chunkBytes));
      const finalRunChunk = inputCycles === 0;
      if (!finalRunChunk) await this.step(inputCycles);
    }
  }
}
/** Explicit endpoint, optional caller-owned fetch (for authentication/timeouts). */
export function createHttpEmulatorClient(endpoint: string, fetcher: typeof fetch = fetch): EmulatorClient {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Expected HTTP endpoint');
  return new EmulatorClient(async request => {
    const response = await fetcher(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),redirect:'error'});
    if (!response.ok) throw new EmulatorError(`HTTP ${response.status}`);
    return response.json();
  });
}
