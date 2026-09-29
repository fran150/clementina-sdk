import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {checkAsset, type AssetKind} from '@clementina/assets';
import {compileBasicProgram, inspectBasicProgram} from '@clementina/basic';
import {errorMessage, type ClementinaDiagnostic} from '@clementina/core';
import type {EmulatorProcess} from '@clementina/emulator-client/node';
import {loadProject} from '@clementina/project/node';
import {isValue, parseDoctorArguments, parseRunArguments} from './arguments.js';
import {probeTool, type ToolProbe} from './doctor.js';
import {EXIT_FAILURE, EXIT_OK, failure, usageFailure, type Command, type CommandResult} from './types.js';

const MINIMUM_NODE_MAJOR = 20;
const DOCTOR_TOOLS = ['ca65', 'ld65', 'ar65', 'emulator'] as const;
type DoctorTool = typeof DOCTOR_TOOLS[number];

/** Convert a validation outcome into a command result. */
function validationResult(ok: boolean, diagnostics: ClementinaDiagnostic[]): CommandResult {
  return {ok, diagnostics, exitCode: ok ? EXIT_OK : EXIT_FAILURE};
}

/** True in the single-file executable, which bundles its own JavaScript runtime. */
const standalone = Boolean(process.versions.bun);

/** `doctor`: report the JavaScript runtime, cc65 tools, and the emulator automation executable. */
const doctor: Command = {
  matches: args => args[0] === 'doctor',
  async run(args, {cwd, dependencies}) {
    const options = parseDoctorArguments(args);
    if (!options) return usageFailure('doctor');
    if (!standalone && Number(process.versions.node.split('.')[0]) < MINIMUM_NODE_MAJOR) {
      return failure('doctor.node', `Node.js ${MINIMUM_NODE_MAJOR} or newer is required`);
    }
    const probe = dependencies.probeTool ?? probeTool;
    const commandFor = (name: DoctorTool) => name === 'emulator' ? options.emulator : name;
    const checked = await Promise.all(DOCTOR_TOOLS.map(name => probe(name, commandFor(name), cwd)));
    const tools = Object.fromEntries(DOCTOR_TOOLS.map((name, index) => [name, checked[index]])) as Record<DoctorTool, ToolProbe>;
    const missing = DOCTOR_TOOLS.filter(name => !tools[name].found);
    const diagnostics: ClementinaDiagnostic[] = missing.map(name => ({
      severity: options.strict ? 'error' : 'warning',
      code: `doctor.${name}`,
      message: name === 'emulator'
        ? `Emulator automation executable unavailable: ${tools[name].detail}. Set CLEMENTINA_EMULATOR or use --emulator.`
        : `${name} unavailable: ${tools[name].detail}. Install cc65 to build assembly projects.`,
    }));
    const failed = options.strict && missing.length > 0;
    return {
      ok: !failed, diagnostics,
      exitCode: failed ? EXIT_FAILURE : EXIT_OK,
      message: `${standalone ? 'Standalone executable' : `Node.js ${process.versions.node}`}; ${DOCTOR_TOOLS.map(name => `${name}: ${tools[name].found ? 'ready' : 'missing'}`).join(', ')}.`,
      data: {...(standalone ? {standalone: true} : {node: process.versions.node}), tools},
    };
  },
};

/** `project validate [directory]`: load and cross-check a portable project. */
const projectValidate: Command = {
  matches: args => args[0] === 'project' && args[1] === 'validate' && args.length <= 3 && !args[2]?.startsWith('-'),
  async run(args, {cwd}) {
    const loaded = await loadProject(resolve(cwd, args[2] ?? '.'));
    return validationResult(loaded.ok, loaded.diagnostics);
  },
};

/** `basic compile <source> <file>`: tokenize numbered BASIC into a LOAD-ready file. */
const basicCompile: Command = {
  matches: args => args[0] === 'basic' && args[1] === 'compile' && args.length === 4 && isValue(args[2]) && isValue(args[3]),
  async run(args, {cwd}) {
    const [, , source, output] = args;
    const sourcePath = resolve(cwd, source), outputPath = resolve(cwd, output);
    if (sourcePath === outputPath) return failure('basic.output', 'Source and output paths must differ', EXIT_FAILURE, output);
    try {
      const bytes = compileBasicProgram(await readFile(sourcePath, 'utf8'));
      await writeFile(outputPath, bytes);
      return {
        ok: true, diagnostics: [], exitCode: EXIT_OK,
        message: `Compiled ${source} to ${output} (${bytes.length} bytes).`,
        data: {source, output, bytes: bytes.length, lines: inspectBasicProgram(bytes).lines.length},
      };
    } catch (error) {
      return failure('basic.compile', errorMessage(error), EXIT_FAILURE, source);
    }
  },
};

/** `build [directory]`: compile the project and emit its SD-card load artifacts. */
const build: Command = {
  matches: args => args[0] === 'build' && args.length <= 2 && !args[1]?.startsWith('-'),
  async run(args, {cwd, dependencies}) {
    const built = await dependencies.buildProject(resolve(cwd, args[1] ?? '.'));
    if (!built.ok) return validationResult(false, built.diagnostics);
    const {value} = built;
    const loadPlan = value.files.find(file => file.kind === 'load-plan')!.path;
    if (value.kind === 'assembly') {
      const bootstrap = value.files.find(file => file.kind === 'bootstrap')!.path;
      return {
        ok: true, diagnostics: built.diagnostics, exitCode: EXIT_OK,
        message: `Built ${value.assembly.artifacts.prg} and ${loadPlan}. SD card: ${value.sdRoot}.`,
        data: {kind: 'assembly', sdRoot: value.sdRoot, prg: value.assembly.artifacts.prg, loadPlan, bootstrap, entryAddress: value.assembly.entryAddress},
      };
    }
    return {
      ok: true, diagnostics: [], exitCode: EXIT_OK,
      message: `Built ${value.basic.artifact} and ${loadPlan}.`,
      data: {kind: 'basic', program: value.basic.artifact, loadPlan, lines: value.basic.lines},
    };
  },
};

/** `run [directory]`: build, start an owned headless emulator, and launch the load plan. */
const run: Command = {
  matches: args => args[0] === 'run',
  async run(args, {cwd, dependencies}) {
    const parsed = parseRunArguments(args);
    if (!parsed) return usageFailure('run');
    const root = resolve(cwd, parsed.directory);
    const built = await dependencies.buildProject(root);
    if (!built.ok) return validationResult(false, built.diagnostics);
    let emulator: EmulatorProcess | undefined;
    try {
      emulator = await dependencies.startEmulatorProcess({executable: parsed.executable, sdRoot: resolve(root, built.value.sdRoot), port: parsed.port});
      const initialState = await emulator.client.launchLoadPlan(built.value.loadPlan);
      return {
        ok: true, diagnostics: [], exitCode: EXIT_OK, session: {emulator, initialState},
        message: `Running at ${emulator.endpoint}. Press Ctrl-C to stop.`,
        data: {
          endpoint: emulator.endpoint, pid: emulator.pid, kind: built.value.kind,
          ...(built.value.kind === 'assembly' ? {entryAddress: built.value.assembly.entryAddress} : {program: built.value.basic.artifact}),
        },
      };
    } catch (error) {
      if (emulator) await emulator.close().catch(() => undefined);
      return failure('run.emulator', errorMessage(error));
    }
  },
};

/** Asset kinds implied by the `sprite` and `animation` command aliases. */
const VALIDATE_KINDS: Readonly<Record<string, AssetKind | undefined>> = {asset: undefined, sprite: 'shapes', animation: 'animations'};

/** `asset|sprite|animation validate <file>`: structurally check one portable asset file. */
const assetValidate: Command = {
  matches: args => Object.hasOwn(VALIDATE_KINDS, args[0]) && args[1] === 'validate' && args.length === 3 && isValue(args[2]),
  async run(args, {cwd}) {
    const source = args[2];
    let text: string;
    try { text = await readFile(resolve(cwd, source), 'utf8'); }
    catch (error) { return failure('asset.io', errorMessage(error), EXIT_FAILURE, source); }
    let value: unknown;
    try { value = JSON.parse(text); }
    catch (error) { return failure('asset.json', errorMessage(error), EXIT_FAILURE, source); }
    const checked = checkAsset(value, VALIDATE_KINDS[args[0]]);
    return validationResult(checked.ok, checked.diagnostics.map(entry => ({...entry, source})));
  },
};

/** Commands in match order; the first match handles the arguments. */
export const commands: readonly Command[] = [doctor, projectValidate, basicCompile, build, run, assetValidate];
