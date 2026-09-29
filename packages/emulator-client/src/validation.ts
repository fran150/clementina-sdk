import type {BankBreakpoint, EmulatorCapabilities, EmulatorStack, EmulatorState, ExecutionState, StopReason} from './index.js';

const stopReasons: readonly StopReason[] = ['initial', 'running', 'pause', 'reset', 'breakpoint', 'instruction', 'cycle-limit', 'mia-paused', 'cpu-stopped'];

/** Test whether a value can be inspected as a protocol object. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Test an inclusive unsigned integer range. */
export function isInteger(value: unknown, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max;
}

/** Validate the capabilities advertised by a version 1 server. */
export function isCapabilities(value: unknown): value is EmulatorCapabilities {
  return isObject(value) && value.version === 1
    && Array.isArray(value.methods) && value.methods.every(method => typeof method === 'string')
    && isInteger(value.maxCycles, Number.MAX_SAFE_INTEGER) && value.maxCycles > 0
    && isInteger(value.maxRead, 65536) && value.maxRead > 0;
}

/** Validate a state response, including optional execution fields from newer servers. */
export function isState(value: unknown): value is EmulatorState {
  return isObject(value) && typeof value.cycles === 'string' && /^(0|[1-9][0-9]*)$/.test(value.cycles)
    && isInteger(value.pc, 65535) && ['a', 'x', 'y', 'sp', 'p'].every(register => isInteger(value[register], 255))
    && typeof value.paused === 'boolean'
    && (value.running === undefined || typeof value.running === 'boolean')
    && (value.instructionBoundary === undefined || typeof value.instructionBoundary === 'boolean')
    && (value.stopReason === undefined || (typeof value.stopReason === 'string' && stopReasons.includes(value.stopReason as StopReason)))
    && (value.bank === undefined || isInteger(value.bank, 31));
}

/** Require the execution metadata used by debugger operations. */
export function isExecutionState(value: unknown): value is ExecutionState {
  return isState(value) && typeof value.running === 'boolean'
    && typeof value.instructionBoundary === 'boolean' && value.stopReason !== undefined;
}

/** Validate a unique list of logical CPU breakpoint addresses. */
export function isAddresses(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(address => isInteger(address, 65535))
    && new Set(value).size === value.length;
}

/** Validate a unique list of physical ExRAM bank breakpoints. */
export function isBankBreakpoints(value: unknown): value is BankBreakpoint[] {
  return Array.isArray(value) && value.every(item => isObject(item)
    && isInteger(item.address, 0xbfff) && item.address >= 0x8000 && isInteger(item.bank, 31))
    && new Set(value.map(item => `${item.address}:${item.bank}`)).size === value.length;
}

/** Validate observed call and interrupt frames from the emulator. */
export function isEmulatorStack(value: unknown): value is EmulatorStack {
  return isObject(value) && Array.isArray(value.callers)
    && value.callers.every(item => isObject(item) && isInteger(item.pc, 65535) && isInteger(item.bank, 31)
      && (item.kind === 'call' || item.kind === 'interrupt'))
    && typeof value.unknownCaller === 'boolean';
}

/** Validate a fixed-length array of protocol bytes. */
export function isByteArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && Array.from(value).every(byte => isInteger(byte, 255));
}

/** Validate a CPU-mapped memory response, where unsupported peeks are null. */
export function isMemoryBytes(value: unknown, length: number): value is (number | null)[] {
  return Array.isArray(value) && value.length === length
    && value.every(byte => byte === null || isInteger(byte, 255));
}

/** Check a caller-supplied byte record before sending it to the transport. */
export function requireByteArray(data: readonly number[], length: number, message: string): number[] {
  if (!isByteArray(data, length)) throw new RangeError(message);
  return Array.from(data);
}

/** Check a positive cycle budget against the automation protocol limit. */
export function requireCycleBudget(value: number, name: string): void {
  if (!isInteger(value, 10_000_000) || value === 0) throw new RangeError(`${name} must be 1..10000000`);
}

/** Check the HID page supported by the automation input hook. */
export function requireHidPage(page: 7 | 12): void {
  if (page !== 7 && page !== 12) throw new RangeError('usagePage must be 7 or 12');
}
