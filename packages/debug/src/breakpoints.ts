import type {EmulatorClient, SourceBreakpointLocation, SourceMapResolver} from '@clementina/emulator-client';
import type {DebugBreakpoint} from './index.js';

/** Return whether a value is a CPU address. */
export function isCpuAddress(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff;
}

/** Return whether a value is an accepted source-map bank (1 through 31). */
export function isSourceBank(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 31;
}

/** Track source requests and only remove breakpoints installed by this session. */
export class SourceBreakpointManager {
  private readonly byPath = new Map<string, Map<number, SourceBreakpointLocation[]>>();
  private readonly owned = new Map<string, SourceBreakpointLocation>();

  /** Bind breakpoint ownership to one client, source map, and optional bank filter. */
  constructor(
    private readonly client: EmulatorClient,
    private readonly sourceMap: SourceMapResolver,
    private readonly bank?: number,
  ) {}

  /** Replace a path's requested lines while retaining shared and external addresses. */
  async set(path: string, lines: readonly number[]): Promise<DebugBreakpoint[]> {
    if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must be a non-empty string');
    if (!Array.isArray(lines) || lines.some(line => !Number.isInteger(line) || line < 1)) throw new RangeError('lines must contain positive integers');

    const resolved = lines.map(line => ({line, ...this.resolveLine(path, line)}));
    const replacement = new Map<number, SourceBreakpointLocation[]>();
    for (const item of resolved) if (item.locations.length > 0) replacement.set(item.line, item.locations);

    const desired = new Map<string, SourceBreakpointLocation>();
    for (const [existingPath, byLine] of this.byPath) {
      if (existingPath === path) continue;
      for (const locations of byLine.values()) for (const location of locations) desired.set(this.key(location), location);
    }
    for (const locations of replacement.values()) for (const location of locations) desired.set(this.key(location), location);

    const active = new Set((await this.client.breakpoints()).map(address => this.key({address})));
    if ([...desired.values(), ...this.owned.values()].some(location => location.bank !== undefined)) {
      for (const location of await this.client.bankBreakpoints()) active.add(this.key(location));
    }
    for (const [key, location] of desired) {
      if (active.has(key)) continue;
      await this.add(location);
      active.add(key);
      this.owned.set(key, location);
    }
    for (const [key, location] of this.owned) {
      if (desired.has(key)) continue;
      await this.remove(location);
      this.owned.delete(key);
    }
    if (replacement.size === 0) this.byPath.delete(path);
    else this.byPath.set(path, replacement);

    return resolved.map(item => item.addresses.length === 0
      ? {path, requestedLine: item.line, verified: false, addresses: [], message: 'No executable code at this line'}
      : {path, requestedLine: item.line, verified: true, line: item.line, addresses: item.addresses, locations: item.locations});
  }

  /** Remove all owned breakpoints and forget every source request. */
  async clear(): Promise<void> {
    for (const [key, location] of this.owned) {
      await this.remove(location);
      this.owned.delete(key);
    }
    this.byPath.clear();
  }

  /** Resolve one line to unique, bank-filtered source-map addresses. */
  private resolveLine(path: string, line: number): {addresses: number[]; locations: SourceBreakpointLocation[]} {
    const locations = this.sourceMap.locationsForSource(path, line);
    if (!Array.isArray(locations)) throw new TypeError('Invalid source map result');
    const selected = new Map<string, SourceBreakpointLocation>();
    for (const location of locations) {
      if (typeof location !== 'object' || location === null || !isCpuAddress(location.address)
        || (location.bank !== undefined && !isSourceBank(location.bank))) throw new TypeError('Invalid source map location');
      if (this.bank !== undefined && location.bank !== undefined && location.bank !== this.bank) continue;
      const resolved = {address: location.address, ...(location.bank === undefined ? {} : {bank: location.bank})};
      selected.set(this.key(resolved), resolved);
    }
    const entries = [...selected.values()].sort((a, b) => a.address - b.address || (a.bank ?? -1) - (b.bank ?? -1));
    return {addresses: [...new Set(entries.map(location => location.address))], locations: entries};
  }

  /** Identify a logical or physical-bank address in the ownership maps. */
  private key(location: SourceBreakpointLocation): string {
    return `${location.address}:${location.bank ?? ''}`;
  }

  /** Install the appropriate emulator breakpoint variant. */
  private async add(location: SourceBreakpointLocation): Promise<void> {
    if (location.bank === undefined) await this.client.addBreakpoint(location.address);
    else await this.client.addBankBreakpoint(location.address, location.bank);
  }

  /** Remove the appropriate emulator breakpoint variant. */
  private async remove(location: SourceBreakpointLocation): Promise<void> {
    if (location.bank === undefined) await this.client.removeBreakpoint(location.address);
    else await this.client.removeBankBreakpoint(location.address, location.bank);
  }
}
