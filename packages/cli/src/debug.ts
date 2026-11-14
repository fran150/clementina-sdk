import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import type {ClementinaDiagnostic} from '@clementina/core';
import type {createProjectDebugSession} from '@clementina/debug/node';
import type {createHttpEmulatorClient} from '@clementina/emulator-client';
import {resolveEmulatorExecutable} from '@clementina/emulator-client/node';
import {loadProject, resolveProjectPath} from '@clementina/project/node';
import {CheckError} from './check.js';

/** Options for `debugProject`; the CLI fills them from its flags. */
export interface DebugOptions {
  /** Physical source line, from 1. */
  line: number;
  /** Project-relative source; defaults to `program.entry`, else the first assembly source. */
  source?: string;
  emulator?: string;
  timeoutMs?: number;
  memory?: {address: number; count: number};
}

/** Side effects `debugProject` needs, replaceable in tests. */
export interface DebugDependencies {
  createProjectDebugSession: typeof createProjectDebugSession;
  createHttpEmulatorClient: (endpoint: string) => Pick<ReturnType<typeof createHttpEmulatorClient>, 'video'>;
}

/** `build/inspection/debug-report.json`. */
export interface DebugReport {
  format: 'clementina-debug-inspection'; version: 1; project: string;
  source: string; requestedLine: number; breakpoint: unknown; stop: unknown;
  memory?: {address: number; bytes: (number | null)[]};
  video: {path: string; bytes: number; sha256: string};
}

const error = (code: string, message: string, source?: string): ClementinaDiagnostic =>
  ({severity: 'error', code, message, ...(source ? {source} : {})});
const fail = (code: string, message: string, source?: string): never => { throw new CheckError([error(code, message, source)]); };

/** Stop on one executable source line and save CPU, memory, and native video evidence. */
export async function debugProject(directory: string, options: DebugOptions, dependencies: DebugDependencies): Promise<{output: string; report: DebugReport}> {
  const root = resolve(directory);
  if (!Number.isInteger(options.line) || options.line < 1) fail('debug.line', 'line must be a positive physical source line');
  const loaded = await loadProject(root);
  if (!loaded.ok) throw new CheckError(loaded.diagnostics);
  const {manifest} = loaded.value;
  const source = options.source ?? manifest.program?.entry ?? manifest.build?.assembly?.sources[0];
  if (!source) return fail('debug.source', 'The project has no program source to debug');
  const path = await resolveProjectPath(root, source);
  const started = await dependencies.createProjectDebugSession(root, {executable: resolveEmulatorExecutable(options.emulator)});
  if (!started.ok) throw new CheckError(started.diagnostics);
  const runtime = started.value;
  try {
    const breakpointPath = runtime.build.basic ? path : source;
    const [breakpoint] = await runtime.session.setSourceBreakpoints(breakpointPath, [options.line]);
    if (!breakpoint?.verified) fail('debug.breakpoint', breakpoint?.message ?? `${source}:${options.line} is not executable code`, source);
    await runtime.launch();
    const snapshot = await runtime.session.waitForStop({timeoutMs: options.timeoutMs ?? 30_000});
    if (snapshot.state.stopReason !== 'breakpoint') fail('debug.stop', `Expected the breakpoint; stopped for ${snapshot.state.stopReason}`);
    const video = Buffer.from(await dependencies.createHttpEmulatorClient(runtime.endpoint).video());
    const memory = options.memory
      ? {address: options.memory.address, bytes: await runtime.session.readMemory(options.memory.address, options.memory.count)}
      : undefined;
    const outputDirectory = dirname(runtime.build.files.find(file => file.kind === 'load-plan')!.path);
    const output = await resolveProjectPath(root, `${outputDirectory}/inspection`);
    await mkdir(output, {recursive: true});
    await writeFile(join(output, 'debug.video.bin'), video);
    const report: DebugReport = {
      format: 'clementina-debug-inspection', version: 1, project: root,
      source, requestedLine: options.line, breakpoint,
      stop: snapshot, ...(memory ? {memory} : {}),
      video: {path: `${outputDirectory}/inspection/debug.video.bin`, bytes: video.length,
        sha256: createHash('sha256').update(video).digest('hex')},
    };
    await writeFile(join(output, 'debug-report.json'), JSON.stringify(report, null, 2) + '\n');
    return {output, report};
  } finally { await runtime.close(); }
}
