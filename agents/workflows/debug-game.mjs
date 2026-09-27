#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProjectDebugSession} from '@clementina/debug/node';
import {createHttpEmulatorClient} from '@clementina/emulator-client';
import {loadProject, resolveProjectPath} from '@clementina/project/node';

function value(result, label) {
  if (result.ok) return result.value;
  throw Error(`${label}: ${result.diagnostics.map(d => `${d.code}: ${d.message}`).join('; ')}`);
}

/** Stop on one executable source line and save CPU, memory, and native video evidence. */
export async function inspectBreakpoint(projectDirectory, options, dependencies = {}) {
  const root = resolve(projectDirectory);
  if (!Number.isInteger(options.line) || options.line < 1) throw Error('line must be a positive physical source line');
  const project = value(await loadProject(root), 'Project');
  const source = options.source ?? project.manifest.program.entry;
  const path = await resolveProjectPath(root, source);
  const runtime = value(await (dependencies.createProjectDebugSession ?? createProjectDebugSession)(root, {
    executable: options.emulator ?? process.env.CLEMENTINA_EMULATOR ?? 'clementina-automation',
  }), 'Debug session');
  try {
    const breakpointPath = runtime.build.kind === 'basic' ? path : source;
    const [breakpoint] = await runtime.session.setSourceBreakpoints(breakpointPath, [options.line]);
    if (!breakpoint.verified) throw Error(breakpoint.message ?? 'Source line did not resolve to executable code');
    await runtime.launch();
    const snapshot = await runtime.session.waitForStop({timeoutMs: options.timeoutMs ?? 30_000});
    if (snapshot.state.stopReason !== 'breakpoint') throw Error(`Expected source breakpoint, stopped for ${snapshot.state.stopReason}`);
    const video = Buffer.from(await (dependencies.createHttpEmulatorClient ?? createHttpEmulatorClient)(runtime.endpoint).video());
    const memory = options.memory
      ? {address: options.memory.address, bytes: await runtime.session.readMemory(options.memory.address, options.memory.count)}
      : undefined;
    const outputDirectory = dirname(runtime.build.files.find(file => file.kind === 'load-plan').path);
    const output = await resolveProjectPath(root, `${outputDirectory}/inspection`);
    await mkdir(output, {recursive: true});
    await writeFile(join(output, 'debug.video.bin'), video);
    const report = {
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [directory, ...args] = process.argv.slice(2);
    if (!directory) throw Error('Usage: debug-game.mjs <project> --line <physical-line> [--source <project-path>] [--emulator <path>] [--timeout <ms>] [--memory <address>:<count>]');
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i], input = args[i + 1];
      if (!input || !['--line', '--source', '--emulator', '--timeout', '--memory'].includes(key) || options[key]) throw Error('Invalid debug options');
      options[key] = input;
    }
    const memory = options['--memory']?.split(':').map(Number);
    if (memory && (memory.length !== 2 || !memory.every(Number.isInteger))) throw Error('memory must be address:count');
    const inspected = await inspectBreakpoint(directory, {
      line: Number(options['--line']), source: options['--source'], emulator: options['--emulator'],
      timeoutMs: options['--timeout'] === undefined ? undefined : Number(options['--timeout']),
      ...(memory ? {memory: {address: memory[0], count: memory[1]}} : {}),
    });
    console.log(`Breakpoint at ${inspected.report.stop.frame.name}; report: ${join(inspected.output, 'debug-report.json')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
