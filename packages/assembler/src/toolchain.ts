import {basename} from 'node:path';
import {result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import type {BuildPaths} from './build-paths.js';
import {toolFailure} from './process.js';
import type {AssemblyBuildRequest, ProcessRunner} from './types.js';

export interface AssembledSources {
  objects: string[];
  listings: string[];
}

/**
 * Assemble sources in link order and collect their object and listing files.
 *
 * @param paths - Resolved source, include, and output paths.
 * @param request - Tool selection, defines, and source names for diagnostics.
 * @param runner - Process runner used to invoke ca65.
 * @returns Object and listing paths, or the first ca65 failure.
 */
export async function assembleSources(
  paths: BuildPaths,
  request: AssemblyBuildRequest,
  runner: ProcessRunner,
): Promise<ValidationResult<AssembledSources>> {
  const objects: string[] = [];
  const listings: string[] = [];
  const command = request.toolchain?.ca65 ?? 'ca65';
  const defines = Object.entries(request.defines ?? {}).sort(([left], [right]) => left.localeCompare(right));

  for (const [index, source] of paths.sources.entries()) {
    const stem = `${String(index).padStart(3, '0')}-${basename(source).replace(/\.[^.]*$/u, '')}`;
    const object = `${paths.outputDirectory}/${stem}.o`;
    const listing = `${paths.outputDirectory}/${stem}.lst`;
    const args = ['--cpu', '65C02', '--debug-info', '--listing', listing];
    for (const directory of paths.includeDirectories) args.push('--include-dir', directory);
    for (const [name, value] of defines) args.push('-D', `${name}=${value}`);
    args.push('-o', object, source);

    const assembled = await runner({command, args, cwd: paths.root});
    if (assembled.exitCode !== 0) {
      return result<AssembledSources>(undefined, [toolFailure('ca65', request.sources[index], assembled)]);
    }
    objects.push(object);
    listings.push(listing);
  }
  return result<AssembledSources>({objects, listings}, []);
}

/**
 * Link assembled objects and libraries into a binary with debug artifacts.
 *
 * @param paths - Resolved linker configuration, libraries, and output paths.
 * @param request - Tool selection and linker configuration name for diagnostics.
 * @param objects - Object files in their original source order.
 * @param runner - Process runner used to invoke ld65.
 * @returns A diagnostic on failure, or undefined on success.
 */
export async function linkImage(
  paths: BuildPaths,
  request: AssemblyBuildRequest,
  objects: readonly string[],
  runner: ProcessRunner,
): Promise<ClementinaDiagnostic | undefined> {
  const linked = await runner({
    command: request.toolchain?.ld65 ?? 'ld65',
    args: [
      '--config', paths.linkerConfig,
      '-o', paths.output.binary,
      '--dbgfile', paths.output.debug,
      '--mapfile', paths.output.map,
      '-Ln', paths.output.labels,
      ...objects,
      ...paths.libraries,
    ],
    cwd: paths.root,
  });
  return linked.exitCode === 0 ? undefined : toolFailure('ld65', request.linkerConfig, linked);
}
