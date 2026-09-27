import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {checkAsset, type AssetKind} from '@clementina/assets';
import {compileBasicProgram, inspectBasicProgram} from '@clementina/basic';
import {buildProject} from '@clementina/build';
import {startEmulatorProcess, type EmulatorProcess, type EmulatorProcessOptions} from '@clementina/emulator-client/node';
import type {ExecutionState} from '@clementina/emulator-client';
import {loadProject} from '@clementina/project/node';
import type {ClementinaDiagnostic} from '@clementina/core';
import {probeTool, type ToolProbe} from './doctor.js';

export interface RunSession {emulator: EmulatorProcess; initialState: ExecutionState}
export interface CommandResult {ok: boolean; diagnostics: ClementinaDiagnostic[]; exitCode: number; message?: string; data?: unknown; session?: RunSession}
export interface CommandDependencies {
  buildProject: typeof buildProject;
  startEmulatorProcess: (options: EmulatorProcessOptions) => Promise<EmulatorProcess>;
  probeTool?: typeof probeTool;
}
const defaultDependencies: CommandDependencies = {buildProject, startEmulatorProcess};
const failure = (code: string, message: string, exitCode = 1, source?: string): CommandResult => ({ok: false, diagnostics: [{severity: 'error', code, message, ...(source ? {source} : {})}], exitCode});
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
interface DoctorArguments {strict: boolean; emulator: string}
function parseDoctorArguments(args: string[]): DoctorArguments | undefined {
  let strict = false, emulator = process.env.CLEMENTINA_EMULATOR ?? 'clementina-automation';
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--strict' && !strict) strict = true;
    else if (args[index] === '--emulator' && index + 1 < args.length && !args[index + 1].startsWith('-')) emulator = args[++index];
    else return undefined;
  }
  return {strict, emulator};
}
interface RunArguments {directory: string; executable: string; port: number}
function parseRunArguments(args: string[]): RunArguments | undefined {
  let directory = '.', executable = process.env.CLEMENTINA_EMULATOR ?? 'clementina-automation', port = 0, positional = false;
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

/** CLI operations are reusable and do not write terminal output or terminate the process. */
export async function executeCommand(args: string[], cwd = process.cwd(), dependencies: CommandDependencies = defaultDependencies): Promise<CommandResult> {
  if (args.length === 0 || args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) return {ok: true, diagnostics: [], exitCode: 0, message: help};
  if (args[0] === 'doctor') {
    const options = parseDoctorArguments(args);
    if (!options) return failure('cli.usage', 'Invalid doctor arguments. Run clementina --help.', 2);
    if (Number(process.versions.node.split('.')[0]) < 20) return failure('doctor.node', 'Node.js 20 or newer is required');
    const probe = dependencies.probeTool ?? probeTool;
    const names = ['ca65', 'ld65', 'ar65', 'emulator'] as const;
    const commands = ['ca65', 'ld65', 'ar65', options.emulator] as const;
    const checked = await Promise.all(names.map((name, index) => probe(name, commands[index], cwd)));
    const tools = Object.fromEntries(names.map((name, index) => [name, checked[index]])) as Record<typeof names[number], ToolProbe>;
    const missing = names.filter(name => !tools[name].found);
    const diagnostics: ClementinaDiagnostic[] = missing.map(name => ({
      severity: options.strict ? 'error' : 'warning',
      code: `doctor.${name}`,
      message: name === 'emulator'
        ? `Emulator automation executable unavailable: ${tools[name].detail}. Set CLEMENTINA_EMULATOR or use --emulator.`
        : `${name} unavailable: ${tools[name].detail}. Install cc65 to build assembly projects.`,
    }));
    return {
      ok: !options.strict || missing.length === 0, diagnostics,
      exitCode: options.strict && missing.length ? 1 : 0,
      message: `Node.js ${process.versions.node}; ${names.map(name => `${name}: ${tools[name].found ? 'ready' : 'missing'}`).join(', ')}.`,
      data: {node: process.versions.node, tools},
    };
  }
  if (args[0] === 'project' && args[1] === 'validate' && args.length <= 3 && !args[2]?.startsWith('-')) {
    const r = await loadProject(resolve(cwd, args[2] ?? '.'));
    return {ok: r.ok, diagnostics: r.diagnostics, exitCode: r.ok ? 0 : 1};
  }
  if (args[0] === 'basic' && args[1] === 'compile' && args.length === 4 && !args[2].startsWith('-') && !args[3].startsWith('-')) {
    const sourcePath = resolve(cwd, args[2]), outputPath = resolve(cwd, args[3]);
    if (sourcePath === outputPath) return failure('basic.output', 'Source and output paths must differ', 1, args[3]);
    try {
      const source = await readFile(sourcePath, 'utf8');
      const bytes = compileBasicProgram(source);
      await writeFile(outputPath, bytes);
      return {
        ok: true, diagnostics: [], exitCode: 0,
        message: `Compiled ${args[2]} to ${args[3]} (${bytes.length} bytes).`,
        data: {source: args[2], output: args[3], bytes: bytes.length, lines: inspectBasicProgram(bytes).lines.length},
      };
    } catch (error) {
      return failure('basic.compile', error instanceof Error ? error.message : String(error), 1, args[2]);
    }
  }
  if (args[0] === 'build' && args.length <= 2 && !args[1]?.startsWith('-')) {
    const r = await dependencies.buildProject(resolve(cwd, args[1] ?? '.'));
    if (!r.ok) return {ok: false, diagnostics: r.diagnostics, exitCode: 1};
    const loadPlan = r.value.files.find(file => file.kind === 'load-plan')!.path;
    if (r.value.kind === 'assembly') {
      const bootstrap = r.value.files.find(file => file.kind === 'bootstrap')!.path;
      return {
        ok: true, diagnostics: r.diagnostics, exitCode: 0,
        message: `Built ${r.value.assembly.artifacts.prg} and ${loadPlan}. SD card: ${r.value.sdRoot}.`,
        data: {kind: 'assembly', sdRoot: r.value.sdRoot, prg: r.value.assembly.artifacts.prg, loadPlan, bootstrap, entryAddress: r.value.assembly.entryAddress},
      };
    }
    return {
      ok: true, diagnostics: [], exitCode: 0,
      message: `Built ${r.value.basic.artifact} and ${loadPlan}.`,
      data: {kind: 'basic', program: r.value.basic.artifact, loadPlan, lines: r.value.basic.lines},
    };
  }
  if (args[0] === 'run') {
    const parsed = parseRunArguments(args);
    if (!parsed) return failure('cli.usage', 'Invalid run arguments. Run clementina --help.', 2);
    const root = resolve(cwd, parsed.directory);
    const built = await dependencies.buildProject(root);
    if (!built.ok) return {ok: false, diagnostics: built.diagnostics, exitCode: 1};
    let emulator: EmulatorProcess | undefined;
    try {
      emulator = await dependencies.startEmulatorProcess({executable: parsed.executable, sdRoot: resolve(root, built.value.sdRoot), port: parsed.port});
      const initialState = await emulator.client.launchLoadPlan(built.value.loadPlan);
      return {
        ok: true, diagnostics: [], exitCode: 0, session: {emulator, initialState},
        message: `Running at ${emulator.endpoint}. Press Ctrl-C to stop.`,
        data: {
          endpoint: emulator.endpoint, pid: emulator.pid, kind: built.value.kind,
          ...(built.value.kind === 'assembly' ? {entryAddress: built.value.assembly.entryAddress} : {program: built.value.basic.artifact}),
        },
      };
    } catch (error) {
      if (emulator) await emulator.close().catch(() => undefined);
      return failure('run.emulator', error instanceof Error ? error.message : String(error));
    }
  }
  if (['asset', 'sprite', 'animation'].includes(args[0]) && args[1] === 'validate' && args.length === 3 && !args[2].startsWith('-')) {
    const source = args[2];
    let value: unknown;
    try {
      const text = await readFile(resolve(cwd, source), 'utf8');
      try { value = JSON.parse(text); }
      catch (e) { return failure('asset.json', e instanceof Error ? e.message : String(e), 1, source); }
    } catch (e) { return failure('asset.io', e instanceof Error ? e.message : String(e), 1, source); }
    const kind: AssetKind | undefined = args[0] === 'sprite' ? 'shapes' : args[0] === 'animation' ? 'animations' : undefined;
    const r = checkAsset(value, kind);
    return {ok: r.ok, diagnostics: r.diagnostics.map(d => ({...d, source})), exitCode: r.ok ? 0 : 1};
  }
  return failure('cli.usage', 'Unknown command or invalid arguments. Run clementina --help.', 2);
}
export async function runCli(args: string[], output: {stdout(text: string): void; stderr(text: string): void}, cwd = process.cwd()): Promise<number> {
  const json = args.includes('--json');
  const r = await executeCommand(args.filter(a => a !== '--json'), cwd);
  const {session, ...visible} = r;
  if (json) output.stdout(JSON.stringify({version: 1, ...visible}) + '\n');
  else {
    if (r.message) output.stdout(r.message.endsWith('\n') ? r.message : r.message + '\n');
    else if (r.ok) output.stdout('Validation passed.\n');
    for (const d of r.diagnostics) output.stderr(`${d.source ?? ''}${d.path ?? ''}: ${d.severity} ${d.code}: ${d.message}\n`);
  }
  if (!session) return r.exitCode;
  let signalExitCode: number | undefined;
  const stopForSignal = (code: number) => {
    signalExitCode ??= code;
    void session.emulator.close();
  };
  const interrupt = () => stopForSignal(130), terminate = () => stopForSignal(143);
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const exited = await session.emulator.exited;
    return signalExitCode ?? (exited.code === 0 ? 0 : 1);
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
}
