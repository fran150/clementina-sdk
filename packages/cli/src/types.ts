import type {buildProject} from '@clementina/build';
import type {ClementinaDiagnostic} from '@clementina/core';
import type {ExecutionState} from '@clementina/emulator-client';
import type {EmulatorProcess, EmulatorProcessOptions} from '@clementina/emulator-client/node';
import type {probeTool} from './doctor.js';

/** An emulator left running by `clementina run` for the terminal host to supervise. */
export interface RunSession {emulator: EmulatorProcess; initialState: ExecutionState}

/** Outcome of one CLI command, independent of how it is printed. */
export interface CommandResult {ok: boolean; diagnostics: ClementinaDiagnostic[]; exitCode: number; message?: string; data?: unknown; session?: RunSession}

/** Side-effecting operations that tests replace. */
export interface CommandDependencies {
  buildProject: typeof buildProject;
  startEmulatorProcess: (options: EmulatorProcessOptions) => Promise<EmulatorProcess>;
  probeTool?: typeof probeTool;
}

/** Inputs shared by every command handler. */
export interface CommandContext {cwd: string; dependencies: CommandDependencies}

/** One CLI command: whether an argument list selects it, and how it runs. */
export interface Command {
  matches(args: readonly string[]): boolean;
  run(args: readonly string[], context: CommandContext): Promise<CommandResult>;
}

/** Exit status for successful commands. */
export const EXIT_OK = 0;
/** Exit status for validation and I/O failures. */
export const EXIT_FAILURE = 1;
/** Exit status for unknown commands or malformed arguments. */
export const EXIT_USAGE = 2;

/** Build a failed result carrying one error diagnostic. */
export function failure(code: string, message: string, exitCode = EXIT_FAILURE, source?: string): CommandResult {
  return {ok: false, diagnostics: [{severity: 'error', code, message, ...(source ? {source} : {})}], exitCode};
}

/** Report invalid arguments for a recognized command. */
export function usageFailure(command: string): CommandResult {
  return failure('cli.usage', `Invalid ${command} arguments. Run clementina --help.`, EXIT_USAGE);
}
