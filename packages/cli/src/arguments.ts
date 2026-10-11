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
