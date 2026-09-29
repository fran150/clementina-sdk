import {copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runProcess, type ProcessRunner} from '@clementina/assembler';
import {diagnostic, errorMessage, result, type ValidationResult} from '@clementina/core';
import {resolveProjectPath} from '@clementina/project/node';
import {runtimeDirectory, runtimeIncludes, runtimeSources} from '@clementina/runtime';
import {joinPortable} from './build-paths.js';

/** Return the highest CODE offset plus emitted bytes in a ca65 listing, including continuation rows. */
export function runtimeCodeSize(listing: string): number {
  let segment = '', size = 0;
  for (const line of listing.split('\n')) {
    const selected = line.slice(23).match(/\.segment\s+"([^"]+)"/);
    if (selected) segment = selected[1];
    if (segment !== 'CODE' || !/^[0-9A-F]{6}r?\s/i.test(line)) continue;
    const bytes = line.slice(11, 23).trim().split(/\s+/).filter(b => /^(?:[0-9a-f]{2}|rr|xx)$/i.test(b));
    if (bytes.length) size = Math.max(size, parseInt(line.slice(0, 6), 16) + bytes.length);
  }
  return size;
}

/**
 * Copies the runtime's sources into the project-relative folder, assembles
 * each with RT_CHECKS set from the build's `checks`, and archives them into
 * runtime.lib there. A failed tool or I/O operation returns diagnostics.
 *
 * @param projectRoot - Root of the portable project.
 * @param folder - Project-relative directory for runtime source and output.
 * @param checks - Whether to define RT_CHECKS as 1 for every module.
 * @param runner - Optional external-tool runner; defaults to runProcess.
 * @returns The project-relative runtime.lib path on success.
 */
export async function buildRuntime(projectRoot: string, folder: string, checks: boolean, runner: ProcessRunner = runProcess): Promise<ValidationResult<string>> {
  try {
    const target = await resolveProjectPath(projectRoot, folder);
    await mkdir(target, {recursive: true});
    for (const name of [...runtimeIncludes, ...runtimeSources]) await copyFile(join(runtimeDirectory, name), join(target, name));
    const objects: string[] = [];
    const codeSizes: Record<string, number> = {};
    for (const name of runtimeSources) {
      const object = join(target, name.replace(/\.s$/u, '.o'));
      const listing = join(target, name.replace(/\.s$/u, '.lst'));
      const assembled = await runner({command: 'ca65', args: ['--cpu', '65C02', '--debug-info', '--listing', listing, '--include-dir', target, '-D', `RT_CHECKS=${checks ? 1 : 0}`, '-o', object, join(target, name)], cwd: target});
      if (assembled.exitCode !== 0) return result(undefined, [{...diagnostic('build.runtime', '', assembled.stderr.trim() || assembled.stdout.trim() || `ca65 exited with status ${assembled.exitCode}`), source: joinPortable(folder, name)}]);
      codeSizes[name] = runtimeCodeSize(await readFile(listing, 'utf8'));
      objects.push(object);
    }
    const library = join(target, 'runtime.lib');
    await rm(library, {force: true});
    const archived = await runner({command: 'ar65', args: ['r', library, ...objects], cwd: target});
    if (archived.exitCode !== 0) return result(undefined, [diagnostic('build.runtime', '', archived.stderr.trim() || archived.stdout.trim() || `ar65 exited with status ${archived.exitCode}`)]);
    await writeFile(join(target, 'code-sizes.json'), JSON.stringify(codeSizes, null, 2) + '\n');
    return result(joinPortable(folder, 'runtime.lib'), []);
  } catch (error) {
    return result(undefined, [diagnostic('build.runtime', '', errorMessage(error))]);
  }
}
