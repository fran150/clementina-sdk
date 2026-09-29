import {renderLoadPlanLaunch, type LoadPlan} from '@clementina/basic';
import {EmulatorError, SourceBreakpointError, SourceStepError} from './errors.js';
import {stepSource, updateSourceBreakpoint} from './source.js';
import {
  isAddresses, isBankBreakpoints, isByteArray, isCapabilities, isEmulatorStack, isExecutionState,
  isInteger, isMemoryBytes, isObject, isState, requireByteArray, requireCycleBudget, requireHidPage,
} from './validation.js';

export {EmulatorError, SourceBreakpointError, SourceStepError};

/** Version 1 headless emulator automation. No Studio or Node runtime dependency. */
export interface EmulatorState {
  cycles: string; pc: number; a: number; x: number; y: number;
  sp: number; p: number; paused: boolean;
  /** Present when the server advertises execution-control methods. */
  running?: boolean; stopReason?: StopReason; instructionBoundary?: boolean;
  /** Physical ExRAM bank selected by VIA Port A, including bank 0. */
  bank?: number;
}
export type StopReason = 'initial' | 'running' | 'pause' | 'reset' | 'breakpoint' | 'instruction' | 'cycle-limit' | 'mia-paused' | 'cpu-stopped';
export interface ExecutionState extends EmulatorState {
  running: boolean; stopReason: StopReason; instructionBoundary: boolean;
}
export interface EmulatorCapabilities {
  version: 1; methods: string[]; maxCycles: number; maxRead: number;
}
export interface SourceBreakpointLocation {address: number; bank?: number}
export interface BankBreakpoint {address: number; bank: number}
export interface EmulatorCaller {pc: number; bank: number; kind: 'call' | 'interrupt'}
export interface EmulatorStack {callers: EmulatorCaller[]; unknownCaller: boolean}
export interface SourceBreakpointResolver {
  /** Return every emitted span start at the exact source line. */
  locationsForSource(path: string, line: number): readonly SourceBreakpointLocation[];
}
export interface SourceStepLocation extends SourceBreakpointLocation {path: string; line: number}
export interface SourceMapResolver extends SourceBreakpointResolver {
  /** Return every source location containing the CPU address and selected bank. */
  locationsForAddress(address: number, bank?: number): readonly SourceStepLocation[];
}
export interface SourceBreakpointResult {
  path: string;
  line: number;
  /** Exact span starts; locations distinguish banks at one address. */
  addresses: number[];
  locations: SourceBreakpointLocation[];
  /** True when at least one source location belongs to banked CPU RAM. */
  banked: boolean;
  /** Complete address-breakpoint list returned by the emulator. */
  breakpoints: number[];
  bankBreakpoints: BankBreakpoint[];
}
export interface SourceStepOptions {
  /** SDK safety budget across machine instructions. */
  maxInstructions?: number;
  /** Cycle budget passed to each machine-instruction step. */
  maxCyclesPerInstruction?: number;
  /** Selects bank metadata when one source map contains several banked images. */
  bank?: number;
}
export type SourceStepReason = 'source-location' | 'unmapped' | 'instruction-limit'
  | 'cycle-limit' | 'mia-paused' | 'cpu-stopped' | 'stopped';
export interface SourceStepResult {
  state: ExecutionState;
  reason: SourceStepReason;
  instructions: number;
  startLocations: SourceStepLocation[];
  locations: SourceStepLocation[];
  /** True only when step-over recognized and returned from the emulator's JSR opcode. */
  steppedOverCall: boolean;
}
/** Send one version 1 request and return its untrusted response envelope. */
export type EmulatorTransport = (request: Record<string, unknown>) => Promise<unknown>;
export interface LaunchLoadPlanOptions {
  /** Existing ROM test budget for reaching the BASIC editor, not a readiness guarantee. */
  bootCycles?: number;
  /** Cycle budget after each input chunk while the ROM editor/tokenizer consumes it. */
  inputCycles?: number;
  /** Raw input chunk size; must fit the MIA's 64-byte text FIFO. */
  inputChunkBytes?: number;
}
/** Requests are never retried: a lost response may follow a completed mutation. */
export class EmulatorClient {
  /** Create a client over a caller-supplied version 1 transport. */
  constructor(private readonly transport: EmulatorTransport) {}
  /** Send one request and validate its protocol envelope and method result. */
  private async call<T>(method: string, params: Record<string, unknown>, check: (v: unknown) => v is T): Promise<T> {
    const response = await this.transport({version: 1, method, ...params});
    if (!isObject(response) || response.version !== 1 || typeof response.ok !== 'boolean') throw new EmulatorError('Invalid protocol response');
    if (!response.ok) {
      if (typeof response.error !== 'string') throw new EmulatorError('Invalid protocol error');
      throw new EmulatorError(response.error);
    }
    if (!check(response.result)) throw new EmulatorError(`Invalid ${method} result`);
    return response.result;
  }
  /** Query supported methods and server limits. */
  capabilities(): Promise<EmulatorCapabilities> {
    return this.call('capabilities', {}, isCapabilities);
  }
  /** Read CPU, MIA pause, and optional execution state. */
  state() { return this.call('state', {}, isState); }
  /** Strict state query for debugger consumers that require execution metadata. */
  executionState() { return this.call('state', {}, isExecutionState); }
  /** Assert and release reset; preserve breakpoints and the cycle counter. */
  reset() { return this.call('reset', {}, isState); }
  /** Advance up to `count` complete cycles while background execution is stopped. */
  step(count: number) {
    requireCycleBudget(count, 'count');
    return this.call('step', {count}, isState);
  }
  /** Starts unthrottled background execution; returns before it stops. */
  run() { return this.call('run', {}, isExecutionState); }
  /** Waits for ownership of the machine, then stops at a complete cycle boundary. */
  pause() { return this.call('pause', {}, isExecutionState); }
  /** Clears MIA execution pause and skips a just-hit breakpoint once. */
  resume() { return this.call('resume', {}, isExecutionState); }
  /** Advances to the next opcode boundary, or reports why it stopped first. */
  stepInstruction(maxCycles = 10000) {
    requireCycleBudget(maxCycles, 'maxCycles');
    return this.call('stepInstruction', {count:maxCycles}, isExecutionState);
  }
  /** Add a logical CPU breakpoint and return all logical breakpoints. */
  addBreakpoint(address: number) {
    if (!isInteger(address,65535)) throw new RangeError('Invalid breakpoint address');
    return this.call('addBreakpoint', {address}, isAddresses);
  }
  /** Remove a logical CPU breakpoint and return the remaining list. */
  removeBreakpoint(address: number) {
    if (!isInteger(address,65535)) throw new RangeError('Invalid breakpoint address');
    return this.call('removeBreakpoint', {address}, isAddresses);
  }
  /** List logical CPU breakpoints in insertion order. */
  breakpoints() { return this.call('breakpoints', {}, isAddresses); }
  /** Remove every logical CPU breakpoint. */
  clearBreakpoints() { return this.call('clearBreakpoints', {}, isAddresses); }
  /** Add a breakpoint for a physical ExRAM bank. */
  addBankBreakpoint(address: number, bank: number) {
    this.checkBankAddress(address, bank);
    return this.call('addBankBreakpoint', {address, bank}, isBankBreakpoints);
  }
  /** Remove a breakpoint for a physical ExRAM bank. */
  removeBankBreakpoint(address: number, bank: number) {
    this.checkBankAddress(address, bank);
    return this.call('removeBankBreakpoint', {address, bank}, isBankBreakpoints);
  }
  /** List physical ExRAM bank breakpoints in insertion order. */
  bankBreakpoints() { return this.call('bankBreakpoints', {}, isBankBreakpoints); }
  /** Remove every physical ExRAM bank breakpoint. */
  clearBankBreakpoints() { return this.call('clearBankBreakpoints', {}, isBankBreakpoints); }
  /** Read observed and validated caller frames from a stopped machine. */
  stackTrace() { return this.call('stackTrace', {}, isEmulatorStack); }
  /** Check a physical bank breakpoint address and bank. */
  private checkBankAddress(address: number, bank: number): void {
    if (!isInteger(address, 0xbfff) || address < 0x8000 || !isInteger(bank, 31)) throw new RangeError('Bank breakpoint requires $8000-$BFFF and bank 0..31');
  }
  /** Resolve one exact source line and add a breakpoint at each emitted span start. */
  async addSourceBreakpoint(sourceMap: SourceBreakpointResolver, path: string, line: number): Promise<SourceBreakpointResult> {
    return updateSourceBreakpoint(this, 'add', sourceMap, path, line);
  }
  /** Resolve one exact source line and remove each corresponding address breakpoint. */
  async removeSourceBreakpoint(sourceMap: SourceBreakpointResolver, path: string, line: number): Promise<SourceBreakpointResult> {
    return updateSourceBreakpoint(this, 'remove', sourceMap, path, line);
  }
  /** Advance until the exact mapped source-location set changes. */
  async stepSource(sourceMap: SourceMapResolver, options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return stepSource(this, 'into', sourceMap, options);
  }
  /** Step a JSR through its matching return; other opcodes use stepSource semantics. */
  async stepOverSource(sourceMap: SourceMapResolver, options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return stepSource(this, 'over', sourceMap, options);
  }
  /** Read CPU-mapped bytes, optionally selecting a physical ExRAM bank. */
  readMemory(address: number, count: number, bank?: number) {
    if (!isInteger(address,65535) || !isInteger(count,65536-address) || count===0) throw new RangeError('Invalid CPU memory range');
    if (bank !== undefined && (!isInteger(bank, 31) || address < 0x8000 || address + count > 0xc000)) throw new RangeError('Bank read must stay within $8000-$BFFF and bank 0..31');
    return this.call('readMemory', {address,count,...(bank === undefined ? {} : {bank})}, (value): value is (number|null)[] => isMemoryBytes(value, count));
  }
  /** Queue 1 to 64 raw console text bytes without stepping the CPU. */
  input(data: readonly number[]) {
    if (!Array.isArray(data) || data.length<1 || data.length>64 || !isByteArray(data, data.length)) throw new RangeError('input must contain 1..64 bytes');
    return this.call('input', {data:Array.from(data)}, isState);
  }
  /** Press or release one held Keyboard/Keypad (7) or Consumer (12) HID usage. Does not enqueue text. */
  setHidUsage(usagePage: 7 | 12, usageId: number, down: boolean) {
    requireHidPage(usagePage);
    if (!isInteger(usageId,255)) throw new RangeError('usageId must be 0..255');
    if (typeof down !== 'boolean') throw new TypeError('down must be a boolean');
    return this.call('setHidUsage', {usagePage,usageId,down}, isState);
  }
  /** Replace one complete 32-byte held HID bitmap; useful for releasing all keys. */
  setHidBitmap(usagePage: 7 | 12, data: readonly number[]) {
    requireHidPage(usagePage);
    return this.call('setHidBitmap', {usagePage,data:requireByteArray(data, 32, 'HID bitmap must contain 32 bytes')}, isState);
  }
  /** Replace one complete 10-byte MIA gamepad record. The first byte includes the connected bit. */
  setGamepadState(player: number, data: readonly number[]) {
    if (!isInteger(player,3)) throw new RangeError('player must be 0..3');
    return this.call('setGamepadState', {player,data:requireByteArray(data, 10, 'gamepad state must contain 10 bytes')}, isState);
  }
  /** Release and disconnect one gamepad slot. */
  clearGamepad(player: number) {
    if (!isInteger(player,3)) throw new RangeError('player must be 0..3');
    return this.call('clearGamepad', {player}, isState);
  }
  /** Read the complete 68,944-byte MIA video state, not rendered pixels. */
  video() {
    return this.call('video', {}, (value): value is number[] => isByteArray(value, 68944));
  }
  /** Audio register block at $12000-$1204F, with live sequencer fields. */
  audio() {
    return this.call('audio', {}, (value): value is number[] => isByteArray(value, 80));
  }
  /**
   * Reset, boot the ROM, enter the plan through the real BASIC command path,
   * and start it. Assembly plans define a numbered bootstrap; BASIC plans
   * execute setup commands followed by LOAD. The automation server must have
   * the build output mounted as its SD root.
   */
  async launchLoadPlan(plan: LoadPlan, options: LaunchLoadPlanOptions = {}): Promise<ExecutionState> {
    const launch = renderLoadPlanLaunch(plan);
    const bootCycles = options.bootCycles ?? 4_000_000;
    // ROM filesystem commands can still be completing after their text is
    // consumed; leave a bounded processing budget before entering the next line.
    const inputCycles = options.inputCycles ?? 1_000_000;
    const chunkBytes = options.inputChunkBytes ?? 48;
    requireCycleBudget(bootCycles, 'bootCycles');
    requireCycleBudget(inputCycles, 'inputCycles');
    if (!isInteger(chunkBytes, 64) || chunkBytes === 0) throw new RangeError('inputChunkBytes must be 1..64');

    await this.reset();
    await this.step(bootCycles);
    for (const line of launch.lines) await this.enterBasicLine(line, inputCycles, chunkBytes);
    await this.enterBasicLine(launch.startCommand, 0, chunkBytes);
    return this.run();
  }

  /** Send an ASCII BASIC line in FIFO-sized chunks, optionally stepping after each chunk. */
  private async enterBasicLine(line: string, inputCycles: number, chunkBytes: number): Promise<void> {
    const bytes = Array.from(line, character => character.charCodeAt(0));
    if (bytes.some(byte => byte > 0x7f)) throw new TypeError('BASIC bootstrap must contain ASCII only');
    bytes.push(13);
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      await this.input(bytes.slice(offset, offset + chunkBytes));
      if (inputCycles !== 0) await this.step(inputCycles);
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
