import {renderLoadPlanLaunch, type LoadPlan} from '@clementina/basic';

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
const stopReasons: readonly string[] = ['initial','running','pause','reset','breakpoint','instruction','cycle-limit','mia-paused','cpu-stopped'];
export interface EmulatorCapabilities {
  version: 1; methods: string[]; maxCycles: number; maxRead: number;
}
export interface SourceBreakpointLocation {address: number; bank?: number}
export interface BankBreakpoint {address: number; bank: number}
export interface EmulatorCaller {pc: number; bank: number; kind: 'call' | 'interrupt'}
export interface EmulatorStack {callers: EmulatorCaller[]; unknownCaller: boolean}
export interface SourceBreakpointResolver {
  locationsForSource(path: string, line: number): readonly SourceBreakpointLocation[];
}
export interface SourceStepLocation extends SourceBreakpointLocation {path: string; line: number}
export interface SourceMapResolver extends SourceBreakpointResolver {
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
export class EmulatorError extends Error {}
export class SourceBreakpointError extends EmulatorError {}
export class SourceStepError extends EmulatorError {}
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
const bankBreakpoints = (v: unknown): v is BankBreakpoint[] => Array.isArray(v) && v.every(item => object(item)
  && integer(item.address, 0xbfff) && Number(item.address) >= 0x8000 && integer(item.bank, 31))
  && new Set(v.map(item => `${item.address}:${item.bank}`)).size === v.length;
const emulatorStack = (v: unknown): v is EmulatorStack => object(v) && Array.isArray(v.callers)
  && v.callers.every(item => object(item) && integer(item.pc, 65535) && integer(item.bank, 31)
    && (item.kind === 'call' || item.kind === 'interrupt')) && typeof v.unknownCaller === 'boolean';
function state(v: unknown): v is EmulatorState {
  return object(v) && typeof v.cycles === 'string' && /^(0|[1-9][0-9]*)$/.test(v.cycles)
    && integer(v.pc, 65535) && ['a','x','y','sp','p'].every(k => integer(v[k],255)) && typeof v.paused === 'boolean'
    && (v.running === undefined || typeof v.running === 'boolean')
    && (v.instructionBoundary === undefined || typeof v.instructionBoundary === 'boolean')
    && (v.stopReason === undefined || (typeof v.stopReason === 'string' && stopReasons.includes(v.stopReason)))
    && (v.bank === undefined || integer(v.bank, 31));
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
  /** Strict state query for debugger consumers that require execution metadata. */
  executionState() { return this.call('state', {}, executionState); }
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
  addBankBreakpoint(address: number, bank: number) {
    this.checkBankAddress(address, bank);
    return this.call('addBankBreakpoint', {address, bank}, bankBreakpoints);
  }
  removeBankBreakpoint(address: number, bank: number) {
    this.checkBankAddress(address, bank);
    return this.call('removeBankBreakpoint', {address, bank}, bankBreakpoints);
  }
  bankBreakpoints() { return this.call('bankBreakpoints', {}, bankBreakpoints); }
  clearBankBreakpoints() { return this.call('clearBankBreakpoints', {}, bankBreakpoints); }
  stackTrace() { return this.call('stackTrace', {}, emulatorStack); }
  private checkBankAddress(address: number, bank: number): void {
    if (!integer(address, 0xbfff) || address < 0x8000 || !integer(bank, 31)) throw new RangeError('Bank breakpoint requires $8000-$BFFF and bank 0..31');
  }
  /** Resolve one exact source line and add a breakpoint at each emitted span start. */
  async addSourceBreakpoint(sourceMap: SourceBreakpointResolver, path: string, line: number): Promise<SourceBreakpointResult> {
    return this.updateSourceBreakpoint('add', sourceMap, path, line);
  }
  /** Resolve one exact source line and remove each corresponding address breakpoint. */
  async removeSourceBreakpoint(sourceMap: SourceBreakpointResolver, path: string, line: number): Promise<SourceBreakpointResult> {
    return this.updateSourceBreakpoint('remove', sourceMap, path, line);
  }
  /** Advance until the exact mapped source-location set changes. */
  async stepSource(sourceMap: SourceMapResolver, options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return this.stepSourceInternal('into', sourceMap, options);
  }
  /** Step a JSR through its matching return; other opcodes use stepSource semantics. */
  async stepOverSource(sourceMap: SourceMapResolver, options: SourceStepOptions = {}): Promise<SourceStepResult> {
    return this.stepSourceInternal('over', sourceMap, options);
  }
  readMemory(address: number, count: number, bank?: number) {
    if (!integer(address,65535) || !integer(count,65536-address) || count===0) throw new RangeError('Invalid CPU memory range');
    if (bank !== undefined && (!integer(bank, 31) || address < 0x8000 || address + count > 0xc000)) throw new RangeError('Bank read must stay within $8000-$BFFF and bank 0..31');
    return this.call('readMemory', {address,count,...(bank === undefined ? {} : {bank})}, (v): v is (number|null)[] => Array.isArray(v) && v.length===count && v.every(b => b===null || integer(b,255)));
  }
  input(data: readonly number[]) {
    if (!Array.isArray(data) || data.length<1 || data.length>64 || !Array.from(data).every(b=>integer(b,255))) throw new RangeError('input must contain 1..64 bytes');
    return this.call('input', {data:Array.from(data)}, state);
  }
  /** Press or release one held Keyboard/Keypad (7) or Consumer (12) HID usage. Does not enqueue text. */
  setHidUsage(usagePage: 7 | 12, usageId: number, down: boolean) {
    if (usagePage !== 7 && usagePage !== 12) throw new RangeError('usagePage must be 7 or 12');
    if (!integer(usageId,255)) throw new RangeError('usageId must be 0..255');
    if (typeof down !== 'boolean') throw new TypeError('down must be a boolean');
    return this.call('setHidUsage', {usagePage,usageId,down}, state);
  }
  /** Replace one complete 32-byte held HID bitmap; useful for releasing all keys. */
  setHidBitmap(usagePage: 7 | 12, data: readonly number[]) {
    if (usagePage !== 7 && usagePage !== 12) throw new RangeError('usagePage must be 7 or 12');
    if (!Array.isArray(data) || data.length !== 32 || !Array.from(data).every(b=>integer(b,255))) throw new RangeError('HID bitmap must contain 32 bytes');
    return this.call('setHidBitmap', {usagePage,data:Array.from(data)}, state);
  }
  /** Replace one complete 10-byte MIA gamepad record. The first byte includes the connected bit. */
  setGamepadState(player: number, data: readonly number[]) {
    if (!integer(player,3)) throw new RangeError('player must be 0..3');
    if (!Array.isArray(data) || data.length !== 10 || !Array.from(data).every(b=>integer(b,255))) throw new RangeError('gamepad state must contain 10 bytes');
    return this.call('setGamepadState', {player,data:Array.from(data)}, state);
  }
  /** Release and disconnect one gamepad slot. */
  clearGamepad(player: number) {
    if (!integer(player,3)) throw new RangeError('player must be 0..3');
    return this.call('clearGamepad', {player}, state);
  }
  video() {
    return this.call('video', {}, (v): v is number[] => Array.isArray(v) && v.length===68944 && v.every(b=>integer(b,255)));
  }
  /** Audio register block at $12000-$1204F, with live sequencer fields. */
  audio() {
    return this.call('audio', {}, (v): v is number[] => Array.isArray(v) && v.length===80 && v.every(b=>integer(b,255)));
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
    if (!integer(bootCycles, 10_000_000) || bootCycles === 0) throw new RangeError('bootCycles must be 1..10000000');
    if (!integer(inputCycles, 10_000_000) || inputCycles === 0) throw new RangeError('inputCycles must be 1..10000000');
    if (!integer(chunkBytes, 64) || chunkBytes === 0) throw new RangeError('inputChunkBytes must be 1..64');

    await this.reset();
    await this.step(bootCycles);
    for (const line of launch.lines) await this.enterBasicLine(line, inputCycles, chunkBytes);
    await this.enterBasicLine(launch.startCommand, 0, chunkBytes);
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

  private async updateSourceBreakpoint(operation: 'add' | 'remove', sourceMap: SourceBreakpointResolver, path: string, line: number): Promise<SourceBreakpointResult> {
    if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must be a non-empty string');
    if (!Number.isInteger(line) || line < 1) throw new RangeError('line must be a positive integer');
    const locations = sourceMap.locationsForSource(path, line);
    if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
    let banked = false;
    const resolved = new Map<string, SourceBreakpointLocation>();
    for (const location of locations) {
      if (!object(location) || !integer(location.address, 65535)
        || (location.bank !== undefined && (!integer(location.bank, 31) || location.bank === 0))) {
        throw new TypeError('Invalid source map location');
      }
      if (location.bank !== undefined) banked = true;
      const item = {address: location.address, ...(location.bank === undefined ? {} : {bank: location.bank})};
      resolved.set(`${item.address}:${item.bank ?? ''}`, item);
    }
    if (resolved.size === 0) throw new SourceBreakpointError(`No executable code at ${path}:${line}`);
    let current: number[] = [], currentBank: BankBreakpoint[] = [];
    for (const item of resolved.values()) {
      if (item.bank === undefined) current = operation === 'add'
        ? await this.addBreakpoint(item.address) : await this.removeBreakpoint(item.address);
      else currentBank = operation === 'add'
        ? await this.addBankBreakpoint(item.address, item.bank) : await this.removeBankBreakpoint(item.address, item.bank);
    }
    return {path, line, addresses: [...new Set([...resolved.values()].map(item => item.address))],
      locations: [...resolved.values()], banked, breakpoints: current, bankBreakpoints: currentBank};
  }

  private sourceLocations(sourceMap: SourceMapResolver, address: number, bank: number | undefined): SourceStepLocation[] {
    const locations = sourceMap.locationsForAddress(address, bank);
    if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
    return locations.map(location => {
      if (!object(location) || typeof location.path !== 'string' || location.path.length === 0
        || !integer(location.line, Number.MAX_SAFE_INTEGER) || location.line === 0
        || !integer(location.address, 65535)
        || (location.bank !== undefined && (!integer(location.bank, 31) || location.bank === 0))) {
        throw new TypeError('Invalid source map location');
      }
      return {path: location.path, line: location.line, address: location.address, ...(location.bank === undefined ? {} : {bank: location.bank})};
    }).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.address - b.address || (a.bank ?? 0) - (b.bank ?? 0));
  }

  private async sourceExecutionState(): Promise<ExecutionState> {
    return this.call('state', {}, executionState);
  }

  private sourceLocationKeys(locations: readonly SourceStepLocation[]): string[] {
    return [...new Set(locations.map(location => `${location.path}\0${location.line}\0${location.bank ?? ''}`))].sort();
  }

  private async stepSourceInternal(mode: 'into' | 'over', sourceMap: SourceMapResolver, options: SourceStepOptions): Promise<SourceStepResult> {
    const maxInstructions = options.maxInstructions ?? 10000;
    const maxCycles = options.maxCyclesPerInstruction ?? 10000;
    if (!integer(maxInstructions, 10000000) || maxInstructions === 0) throw new RangeError('maxInstructions must be 1..10000000');
    if (!integer(maxCycles, 10000000) || maxCycles === 0) throw new RangeError('maxCyclesPerInstruction must be 1..10000000');
    if (options.bank !== undefined && (!integer(options.bank, 31) || options.bank === 0)) throw new RangeError('bank must be 1..31');

    let current = await this.sourceExecutionState();
    if (current.running) throw new SourceStepError('Pause before source stepping');
    if (!current.instructionBoundary) throw new SourceStepError('Source stepping requires an instruction boundary');
    const startLocations = this.sourceLocations(sourceMap, current.pc, current.bank ?? options.bank);
    const startKeys = this.sourceLocationKeys(startLocations);
    const startPC = current.pc, startSP = current.sp, startBank = current.bank;
    let instructions = 0, steppedOverCall = false;

    if (mode === 'over') {
      const opcode = await this.readMemory(startPC, 1);
      if (opcode[0] === null) throw new SourceStepError(`Cannot inspect opcode at $${startPC.toString(16).toUpperCase().padStart(4, '0')}`);
      if (opcode[0] === 0x20) {
        steppedOverCall = true;
        const returnPC = (startPC + 3) & 0xffff;
        while (instructions < maxInstructions) {
          current = await this.stepInstruction(maxCycles);
          instructions++;
          const terminal = this.sourceStepTerminal(current);
          if (terminal !== undefined) return this.sourceStepResult(current, terminal, instructions, startLocations, sourceMap, current.bank ?? options.bank, true);
          if (current.pc === returnPC && current.sp === startSP && current.bank === startBank) break;
        }
        if (current.pc !== returnPC || current.sp !== startSP || current.bank !== startBank) {
          return this.sourceStepResult(current, 'instruction-limit', instructions, startLocations, sourceMap, current.bank ?? options.bank, true);
        }
      }
    }

    while (instructions < maxInstructions) {
      if (steppedOverCall || instructions > 0) {
        const locations = this.sourceLocations(sourceMap, current.pc, current.bank ?? options.bank);
        if (startKeys.length === 0 || locations.length === 0) {
          return {state: current, reason: 'unmapped', instructions, startLocations, locations, steppedOverCall};
        }
        const keys = this.sourceLocationKeys(locations);
        if (keys.length !== startKeys.length || keys.some((key, index) => key !== startKeys[index])) {
          return {state: current, reason: 'source-location', instructions, startLocations, locations, steppedOverCall};
        }
      }
      current = await this.stepInstruction(maxCycles);
      instructions++;
      const terminal = this.sourceStepTerminal(current);
      if (terminal !== undefined) return this.sourceStepResult(current, terminal, instructions, startLocations, sourceMap, current.bank ?? options.bank, steppedOverCall);
    }
    return this.sourceStepResult(current, 'instruction-limit', instructions, startLocations, sourceMap, current.bank ?? options.bank, steppedOverCall);
  }

  private sourceStepTerminal(state: ExecutionState): SourceStepReason | undefined {
    if (state.stopReason === 'instruction' && state.instructionBoundary) return undefined;
    if (state.stopReason === 'cycle-limit' || state.stopReason === 'mia-paused' || state.stopReason === 'cpu-stopped') return state.stopReason;
    return 'stopped';
  }

  private sourceStepResult(state: ExecutionState, reason: SourceStepReason, instructions: number, startLocations: SourceStepLocation[], sourceMap: SourceMapResolver, bank: number | undefined, steppedOverCall: boolean): SourceStepResult {
    return {state, reason, instructions, startLocations, locations: this.sourceLocations(sourceMap, state.pc, bank), steppedOverCall};
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
