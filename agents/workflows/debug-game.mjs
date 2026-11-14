#!/usr/bin/env node
// A thin wrapper over `clementina debug` for agents that import the workflow module.
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CheckError, debugProject} from '@clementina/cli';
import {createProjectDebugSession} from '@clementina/debug/node';
import {createHttpEmulatorClient} from '@clementina/emulator-client';

/** Same as `clementina debug`: stop on one source line and save CPU, memory, and native video evidence. */
export async function inspectBreakpoint(projectDirectory, options, dependencies = {}) {
  try {
    return await debugProject(projectDirectory, options, {
      createProjectDebugSession: dependencies.createProjectDebugSession ?? createProjectDebugSession,
      createHttpEmulatorClient: dependencies.createHttpEmulatorClient ?? createHttpEmulatorClient,
    });
  } catch (error) {
    if (error instanceof CheckError) throw new Error(error.message);
    throw error;
  }
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
