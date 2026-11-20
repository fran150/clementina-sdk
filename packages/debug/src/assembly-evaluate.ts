import type {DebugSymbol} from '@clementina/assembler';
import {formatHex} from '@clementina/core';

/** One hover or watch result from the debugger. */
export interface DebugEvaluation {
  name: string;
  value: string;
  /** `register`, `label` or `constant` for assembly; BASIC variable types otherwise. */
  type: string;
}

/** Registers a hover can name, by their usual spellings. */
const REGISTERS: Record<string, 'a' | 'x' | 'y' | 'sp' | 'p' | 'pc'> = {A: 'a', X: 'x', Y: 'y', S: 'sp', SP: 'sp', P: 'p', PC: 'pc'};

/** Bytes shown after a label's address. */
export const LABEL_PREVIEW_BYTES = 8;

/** CPU register values as the debugger reports them. */
export interface EvaluationRegisters {pc: number; a: number; x: number; y: number; sp: number; p: number}

/** A register name as the 65C02 and ca65 spell it, or undefined. */
export function registerName(expression: string): keyof EvaluationRegisters | undefined {
  return REGISTERS[expression.trim().toUpperCase()];
}

/** `$2A (42)`, with the 16-bit width for a 16-bit value. */
function hexAndDecimal(value: number): string {
  return `${formatHex(value, value > 0xff ? 4 : 2)} (${value})`;
}

/** The NV-BDIZC flags as letters: uppercase when set, lowercase when clear. */
function flags(p: number): string {
  return 'NV-BDIZC'.split('').map((letter, bit) => letter === '-' ? '-' : (p & (0x80 >> bit)) ? letter : letter.toLowerCase()).join('');
}

/** The status register as hex, flag letters (uppercase = set) and binary: `$83 Nv-bdiZC %10000011`. */
export function formatStatusRegister(p: number): string {
  return `${formatHex(p, 2)} ${flags(p)} %${p.toString(2).padStart(8, '0')}`;
}

/** Show a register the way the Registers view does, with P's flags spelled out. */
export function evaluateRegister(expression: string, registers: EvaluationRegisters): DebugEvaluation | undefined {
  const key = registerName(expression);
  if (!key) return undefined;
  const value = registers[key];
  return {
    name: expression.trim().toUpperCase(),
    value: key === 'pc' ? formatHex(value, 4) : key === 'p' ? formatStatusRegister(value) : hexAndDecimal(value),
    type: 'register',
  };
}

/**
 * Assembly symbols from the ld65 debug info, looked up by name. A name can
 * have several definitions: an `.include`d constant once per module (always
 * the same value), and a cheap local such as `@next` once per enclosing label.
 */
export class AssemblySymbols {
  private readonly byName = new Map<string, DebugSymbol[]>();

  constructor(symbols: readonly DebugSymbol[]) {
    for (const symbol of symbols) {
      if (!symbol.name || (symbol.type !== 'lab' && symbol.type !== 'equ')) continue;
      const list = this.byName.get(symbol.name) ?? [];
      if (!list.some(other => other.value === symbol.value && other.type === symbol.type)) list.push(symbol);
      this.byName.set(symbol.name, list);
    }
  }

  /**
   * The symbol a name means at this program counter: its only value, or, for
   * a name defined in several places with different values, the closest
   * label at or below the program counter (the cheap local in the routine
   * that is running).
   */
  find(name: string, pc?: number): DebugSymbol | undefined {
    const list = this.byName.get(name.trim());
    if (!list?.length) return undefined;
    if (list.length === 1 || pc === undefined) return list[0];
    const below = list.filter(symbol => symbol.value <= pc).sort((a, b) => b.value - a.value);
    return below[0] ?? list[0];
  }
}

/**
 * Describe a symbol: a constant shows its value, and a label shows its
 * address and the bytes there (`bytes` may hold null for unreadable memory).
 */
export function describeSymbol(symbol: DebugSymbol, bytes?: readonly (number | null)[]): DebugEvaluation {
  if (symbol.type !== 'lab') return {name: symbol.name, value: hexAndDecimal(symbol.value), type: 'constant'};
  const preview = bytes?.length ? `: ${bytes.map(byte => byte === null ? '??' : byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')}` : '';
  return {name: symbol.name, value: `${formatHex(symbol.value, 4)}${preview}`, type: 'label'};
}
