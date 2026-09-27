#!/usr/bin/env node
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkGame} from './create-game.mjs';

/** Run the shared validate/build/emulate path with at least one behavioral check. */
export async function verifyCode(projectDirectory, settings = {}, dependencies = {}) {
  const inspected = await checkGame(projectDirectory, settings, dependencies);
  const checks = inspected.report.checks;
  if (!checks.memory?.length && !checks.beforeText) {
    throw Error('Add checks/code.json or checks/smoke.json before verifying code');
  }
  return inspected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [directory, ...args] = process.argv.slice(2);
    if (!directory) throw Error('Usage: code-game.mjs <project> [--emulator <path>] [--renderer <path>]');
    const settings = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i], input = args[i + 1];
      if (!input || !['--emulator', '--renderer'].includes(key) || settings[key]) throw Error('Invalid code workflow options');
      settings[key] = input;
    }
    const {output} = await verifyCode(directory, {emulator: settings['--emulator'], renderer: settings['--renderer']});
    console.log(`Code checks passed; report: ${join(output, 'report.json')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
