import {basename, isAbsolute, relative} from 'node:path';
import {Breakpoint, Source, StackFrame, Variable} from '@vscode/debugadapter';
import type {DebugProtocol} from '@vscode/debugprotocol';
import {formatHex} from '@clementina/core';
import type {DebugBreakpoint, DebugInstruction, DebugRegisters, DebugStack} from '@clementina/debug';

/** Create a DAP source from a path reported by the debugger. */
function source(path: string): Source {
  return new Source(basename(path), path);
}

/** Use a project-relative breakpoint path when the client supplies an absolute path. */
export function breakpointPath(projectRoot: string | undefined, path: string): string {
  return projectRoot && isAbsolute(path) ? relative(projectRoot, path) : path;
}

/** Convert source breakpoint results without losing an unverified-line message. */
export function dapBreakpoints(path: string, resolved: readonly DebugBreakpoint[]): Breakpoint[] {
  return resolved.map(item => {
    const breakpoint = new Breakpoint(item.verified, item.line, undefined, source(path));
    if (item.message) (breakpoint as DebugProtocol.Breakpoint).message = item.message;
    return breakpoint;
  });
}

/** Convert verified debugger frames and the optional unknown-caller boundary. */
export function dapStackFrames(stack: DebugStack): StackFrame[] {
  const frames = stack.frames.map(frame => {
    const item = new StackFrame(frame.id, frame.name, frame.source ? source(frame.source.path) : undefined, frame.source?.line ?? 0);
    item.instructionPointerReference = `0x${frame.instructionPointer.toString(16).toUpperCase()}${frame.bank !== undefined && frame.instructionPointer >= 0x8000 && frame.instructionPointer < 0xc000 ? `@${frame.bank}` : ''}`;
    return item;
  });
  if (stack.unknownCaller) frames.push(new StackFrame(frames.length + 1, 'Unknown caller (unverified stack)', undefined, 0));
  return frames;
}

export interface DisassemblyRange {
  address: number;
  count: number;
  skip: number;
  bank?: number;
}

/** Validate the forward-only DAP disassembly request before accessing the session. */
export function disassemblyRange(args: DebugProtocol.DisassembleArguments): DisassemblyRange {
  const match = /^(?:0x)?([0-9a-fA-F]{1,4})(?:@([0-9]|[12][0-9]|3[01]))?$/.exec(args.memoryReference);
  if (!match) throw new Error('Expected a hexadecimal CPU memory reference');
  const address = Number.parseInt(match[1], 16) + (args.offset ?? 0);
  const skip = args.instructionOffset ?? 0;
  if (!Number.isInteger(address) || address < 0 || address > 0xffff || !Number.isInteger(skip) || skip < 0
    || !Number.isInteger(args.instructionCount) || args.instructionCount < 1 || args.instructionCount + skip > 64) {
    throw new RangeError('Disassembly supports 1..64 forward instructions within CPU memory');
  }
  return {address, count: args.instructionCount, skip, bank: match[2] === undefined ? undefined : Number(match[2])};
}

/** Convert decoded instructions and fill any unavailable slots required by DAP. */
export function dapInstructions(decoded: readonly DebugInstruction[], range: DisassemblyRange): DebugProtocol.DisassembledInstruction[] {
  const instructions: DebugProtocol.DisassembledInstruction[] = decoded.slice(range.skip).map(item => ({
    address: `0x${item.address.toString(16).toUpperCase().padStart(4, '0')}`,
    instructionBytes: item.bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    instruction: item.text,
    ...(item.source ? {location: source(item.source.path), line: item.source.line} : {}),
  }));
  while (instructions.length < range.count) {
    instructions.push({
      address: `0x${Math.min(0xffff, range.address + instructions.length).toString(16).toUpperCase().padStart(4, '0')}`,
      instruction: 'Unavailable',
      presentationHint: 'invalid',
    });
  }
  return instructions;
}

/** Present a stopped CPU's registers in the existing DAP scope order. */
export function registerVariables(registers: DebugRegisters): Variable[] {
  return [
    new Variable('PC', formatHex(registers.pc, 4)),
    ...(registers.bank === undefined ? [] : [new Variable('Bank', String(registers.bank))]),
    new Variable('A', formatHex(registers.a, 2)),
    new Variable('X', formatHex(registers.x, 2)),
    new Variable('Y', formatHex(registers.y, 2)),
    new Variable('SP', formatHex(registers.sp, 2)),
    new Variable('P', formatHex(registers.p, 2)),
    new Variable('cycles', registers.cycles),
    new Variable('MIA paused', String(registers.miaPaused)),
  ];
}
