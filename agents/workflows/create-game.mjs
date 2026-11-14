#!/usr/bin/env node
// Thin wrappers over `clementina new` and `clementina check` for agents that
// import the workflow modules or run them from an SDK checkout.
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildProject} from '@clementina/build';
import {CheckError, checkProject, createProject} from '@clementina/cli';
import {startEmulatorProcess} from '@clementina/emulator-client/node';

const usage = `Usage:
  node agents/workflows/create-game.mjs init <new-directory> [--name <name>] [--template basic|assembly]
  node agents/workflows/create-game.mjs check <project-directory> [--emulator <path>] [--renderer <path>]

These are the same as clementina new and clementina check.
`;

function options(args, names) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || i + 1 >= args.length || args[i + 1].startsWith('--') || values[args[i]] !== undefined) {
      throw new Error(`Invalid options.\n${usage}`);
    }
    values[args[i]] = args[i + 1];
  }
  return values;
}

/** Same as `clementina new`. */
export async function initGame(destination, name = 'Catch the Star', template = 'basic') {
  return (await createProject(destination, {name, template})).root;
}

/** Same as `clementina check`, throwing when a check fails. */
export async function checkGame(projectDirectory, settings = {}, dependencies = {}) {
  let outcome;
  try {
    outcome = await checkProject(projectDirectory, settings, {
      buildProject: dependencies.buildProject ?? buildProject,
      startEmulatorProcess: dependencies.startEmulatorProcess ?? startEmulatorProcess,
    });
  } catch (error) {
    if (error instanceof CheckError) throw new Error(`Check failed:\n${error.message}`);
    throw error;
  }
  if (!outcome.passed) throw new Error(`Smoke inspection failed; see ${join(outcome.output, 'report.json')}`);
  return {output: outcome.output, report: outcome.report};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, directory, ...rest] = process.argv.slice(2);
    if (!directory || !['init', 'check'].includes(command)) throw new Error(usage);
    if (command === 'init') {
      const args = options(rest, ['--name', '--template']);
      const template = args['--template'] ?? 'basic';
      const root = await initGame(directory, args['--name'] ?? (template === 'assembly' ? 'Assembly Starter' : 'Catch the Star'), template);
      console.log(`Created ${root}`);
    } else {
      const args = options(rest, ['--emulator', '--renderer']);
      const {output, report} = await checkGame(directory, {emulator: args['--emulator'], renderer: args['--renderer']});
      console.log(`Validated, built, ran, and inspected ${report.project}`);
      console.log(`CPU: PC=$${report.before.state.pc.toString(16).toUpperCase().padStart(4, '0')}, cycles=${report.before.state.cycles}`);
      console.log(`Screen:\n${report.before.overlayRows.filter(Boolean).join('\n')}`);
      if (report.after) console.log(`After input:\n${report.after.overlayRows.filter(Boolean).join('\n')}`);
      console.log(`Inspection: ${join(output, 'report.json')}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
