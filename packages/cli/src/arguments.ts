import {resolveEmulatorExecutable} from '@clementina/emulator-client/node';

/** Options accepted by `clementina doctor`. */
export interface DoctorArguments {strict: boolean; emulator: string}

/** Options accepted by `clementina run`. */
export interface RunArguments {directory: string; executable: string; port: number}

/** Test whether an argument is a plain value rather than a flag. */
export function isValue(arg: string | undefined): arg is string {
  return arg !== undefined && !arg.startsWith('-');
}

/** Parse `doctor [--strict] [--emulator <path>]`, rejecting repeats and unknown flags. */
export function parseDoctorArguments(args: readonly string[]): DoctorArguments | undefined {
  let strict = false, emulator = resolveEmulatorExecutable();
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--strict' && !strict) strict = true;
    else if (args[index] === '--emulator' && isValue(args[index + 1])) emulator = args[++index];
    else return undefined;
  }
  return {strict, emulator};
}

/** Parse `run [directory] [--emulator <path>] [--port <0..65535>]`. */
export function parseRunArguments(args: readonly string[]): RunArguments | undefined {
  let directory = '.', executable = resolveEmulatorExecutable(), port = 0, positional = false;
  for (let index = 1; index < args.length; index++) {
    const value = args[index];
    if (value === '--emulator') {
      if (index + 1 >= args.length || args[index + 1].startsWith('--')) return undefined;
      executable = args[++index];
    } else if (value === '--port') {
      if (index + 1 >= args.length || !/^(0|[1-9][0-9]{0,4})$/u.test(args[index + 1])) return undefined;
      port = Number(args[++index]);
      if (port > 65535) return undefined;
    } else if (value.startsWith('-') || positional) return undefined;
    else { directory = value; positional = true; }
  }
  return {directory, executable, port};
}

/** Options accepted by `clementina project import`. */
export interface ImportArguments {source: string; directory: string; name?: string}

/** Parse `project import <file.cstudio> <directory> [--name <name>]`. */
export function parseImportArguments(args: readonly string[]): ImportArguments | undefined {
  const positional: string[] = [];
  let name: string | undefined;
  for (let index = 2; index < args.length; index++) {
    if (args[index] === '--name' && name === undefined && isValue(args[index + 1])) name = args[++index];
    else if (isValue(args[index]) && positional.length < 2) positional.push(args[index]);
    else return undefined;
  }
  if (positional.length !== 2) return undefined;
  return {source: positional[0], directory: positional[1], ...(name !== undefined ? {name} : {})};
}

/** Options accepted by `clementina new`. */
export interface NewArguments {directory: string; template?: string; name?: string}

/** Parse `new <directory> [--template <name>] [--name <name>]`, rejecting repeats and unknown flags. */
export function parseNewArguments(args: readonly string[]): NewArguments | undefined {
  let directory: string | undefined, template: string | undefined, name: string | undefined;
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--template' && template === undefined && isValue(args[index + 1])) template = args[++index];
    else if (args[index] === '--name' && name === undefined && isValue(args[index + 1])) name = args[++index];
    else if (isValue(args[index]) && directory === undefined) directory = args[index];
    else return undefined;
  }
  if (directory === undefined) return undefined;
  return {directory, ...(template !== undefined ? {template} : {}), ...(name !== undefined ? {name} : {})};
}

/** Options accepted by `clementina check`. */
export interface CheckArguments {directory: string; emulator?: string; renderer?: string}

/** Parse `check [directory] [--emulator <path>] [--renderer <path>]`. */
export function parseCheckArguments(args: readonly string[]): CheckArguments | undefined {
  let directory: string | undefined, emulator: string | undefined, renderer: string | undefined;
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--emulator' && emulator === undefined && isValue(args[index + 1])) emulator = args[++index];
    else if (args[index] === '--renderer' && renderer === undefined && isValue(args[index + 1])) renderer = args[++index];
    else if (isValue(args[index]) && directory === undefined) directory = args[index];
    else return undefined;
  }
  return {directory: directory ?? '.', ...(emulator !== undefined ? {emulator} : {}), ...(renderer !== undefined ? {renderer} : {})};
}

/** Options accepted by `clementina debug`. */
export interface DebugArguments {
  directory: string; line: number; source?: string; emulator?: string; timeoutMs?: number;
  memory?: {address: number; count: number};
}

/** A CPU address or byte count: decimal, `$hex`, or `0xhex`. */
function parseNumber(text: string): number | undefined {
  const match = /^(?:\$([0-9A-Fa-f]{1,4})|0[xX]([0-9A-Fa-f]{1,4})|(0|[1-9][0-9]{0,4}))$/u.exec(text);
  if (!match) return undefined;
  return match[3] !== undefined ? Number(match[3]) : parseInt(match[1] ?? match[2], 16);
}

/** Parse `debug [directory] --line <n> [--source <path>] [--memory <address>:<count>] [--emulator <path>] [--timeout <ms>]`. */
export function parseDebugArguments(args: readonly string[]): DebugArguments | undefined {
  let directory: string | undefined, line: number | undefined, source: string | undefined, emulator: string | undefined;
  let timeoutMs: number | undefined, memory: DebugArguments['memory'];
  for (let index = 1; index < args.length; index++) {
    const flag = args[index], next = args[index + 1];
    if (flag === '--line' && line === undefined && next !== undefined && /^[1-9][0-9]{0,5}$/u.test(next)) { line = Number(next); index++; }
    else if (flag === '--source' && source === undefined && isValue(next)) { source = next; index++; }
    else if (flag === '--emulator' && emulator === undefined && isValue(next)) { emulator = next; index++; }
    else if (flag === '--timeout' && timeoutMs === undefined && next !== undefined && /^[1-9][0-9]{0,6}$/u.test(next)) { timeoutMs = Number(next); index++; }
    else if (flag === '--memory' && memory === undefined && next !== undefined) {
      const [address, count, extra] = next.split(':').map(parseNumber);
      if (address === undefined || count === undefined || extra !== undefined || next.split(':').length !== 2) return undefined;
      if (address > 0xffff || count < 1 || address + count > 0x10000) return undefined;
      memory = {address, count}; index++;
    }
    else if (isValue(flag) && directory === undefined) directory = flag;
    else return undefined;
  }
  if (line === undefined) return undefined;
  return {
    directory: directory ?? '.', line,
    ...(source !== undefined ? {source} : {}), ...(emulator !== undefined ? {emulator} : {}),
    ...(timeoutMs !== undefined ? {timeoutMs} : {}), ...(memory ? {memory} : {}),
  };
}
