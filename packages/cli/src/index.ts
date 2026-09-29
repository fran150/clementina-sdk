import {buildProject} from '@clementina/build';
import {startEmulatorProcess} from '@clementina/emulator-client/node';
import {commands} from './commands.js';
import {EXIT_FAILURE, EXIT_OK, EXIT_USAGE, failure, type CommandDependencies, type CommandResult, type RunSession} from './types.js';

export type {CommandDependencies, CommandResult, RunSession} from './types.js';

const defaultDependencies: CommandDependencies = {buildProject, startEmulatorProcess};
const HELP_FLAGS = ['--help', '-h', 'help'];

export const help = `Usage: clementina <command> [--json]
  project validate [directory]   Validate manifest, assets, references, and sources
  asset validate <file>          Validate any portable asset
  sprite validate <file>         Validate a portable shape (one or more sprites)
  animation validate <file>      Validate a portable animation
  basic compile <source> <file>  Compile numbered source to a LOAD-ready BASIC file
  build [directory]              Compile and emit project load artifacts
  run [directory] [options]      Build and run with an owned headless emulator
  doctor [--strict] [--emulator <path>]
                                Check Node, assembler tools, and emulator

Run options:
  --emulator <path>              Automation executable (default: clementina-automation)
  --port <0..65535>              Fixed loopback port (default: automatic)

Exit codes: 0 success, 1 validation/I/O failure, 2 invalid command.
Standalone assets are checked structurally; use project validate for references.
`;

/** CLI operations are reusable and do not write terminal output or terminate the process. */
export async function executeCommand(args: string[], cwd = process.cwd(), dependencies: CommandDependencies = defaultDependencies): Promise<CommandResult> {
  if (args.length === 0 || args.length === 1 && HELP_FLAGS.includes(args[0])) return {ok: true, diagnostics: [], exitCode: EXIT_OK, message: help};
  const command = commands.find(candidate => candidate.matches(args));
  if (!command) return failure('cli.usage', 'Unknown command or invalid arguments. Run clementina --help.', EXIT_USAGE);
  return command.run(args, {cwd, dependencies});
}

/** Terminal streams used by `runCli`. */
export interface CliOutput {stdout(text: string): void; stderr(text: string): void}

/** Conventional exit statuses for a process stopped by SIGINT and SIGTERM. */
const SIGNAL_EXIT_CODES = {SIGINT: 130, SIGTERM: 143} as const;

/** Print a result as a version 1 JSON document or as human-readable lines. */
function printResult(result: CommandResult, json: boolean, output: CliOutput): void {
  const {session: _session, ...visible} = result;
  if (json) {
    output.stdout(JSON.stringify({version: 1, ...visible}) + '\n');
    return;
  }
  if (result.message) output.stdout(result.message.endsWith('\n') ? result.message : result.message + '\n');
  else if (result.ok) output.stdout('Validation passed.\n');
  for (const entry of result.diagnostics) {
    output.stderr(`${entry.source ?? ''}${entry.path ?? ''}: ${entry.severity} ${entry.code}: ${entry.message}\n`);
  }
}

/** Keep a `run` session alive until the emulator exits or the user interrupts it. */
async function superviseSession(session: RunSession): Promise<number> {
  let signalExitCode: number | undefined;
  const handlers = Object.entries(SIGNAL_EXIT_CODES).map(([signal, code]) => {
    const handler = () => {
      signalExitCode ??= code;
      void session.emulator.close();
    };
    process.once(signal, handler);
    return [signal, handler] as const;
  });
  try {
    const exited = await session.emulator.exited;
    return signalExitCode ?? (exited.code === 0 ? EXIT_OK : EXIT_FAILURE);
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

/** Run one command for a terminal and return the process exit status. */
export async function runCli(args: string[], output: CliOutput, cwd = process.cwd()): Promise<number> {
  const json = args.includes('--json');
  const result = await executeCommand(args.filter(arg => arg !== '--json'), cwd);
  printResult(result, json, output);
  return result.session ? superviseSession(result.session) : result.exitCode;
}
