import {mkdir, realpath} from 'node:fs/promises';
import {relative} from 'node:path';
import {resolveProjectPath} from '@clementina/project/node';
import type {AssemblyBuildRequest} from './types.js';

export interface BuildPaths {
  root: string;
  outputDirectory: string;
  linkerConfig: string;
  sources: string[];
  includeDirectories: string[];
  libraries: string[];
  output: {
    binary: string;
    prg: string;
    debug: string;
    map: string;
    labels: string;
  };
}

/**
 * Express an absolute artifact path relative to the project root with POSIX separators.
 *
 * @param root - Resolved project root.
 * @param path - Absolute path to an artifact or source file.
 * @returns A project-relative path suitable for portable build metadata.
 */
export function projectRelativePath(root: string, path: string): string {
  return relative(root, path).split('\\').join('/');
}

/**
 * Resolve build inputs inside the project and create the declared output directory.
 *
 * @param projectRoot - Directory containing the assembly project.
 * @param request - Validated build request with project-relative paths.
 * @returns Absolute input and output paths used by the toolchain.
 * @throws If the project cannot be resolved or a path fails project path checks.
 */
export async function prepareBuildPaths(projectRoot: string, request: AssemblyBuildRequest): Promise<BuildPaths> {
  const root = await realpath(projectRoot);
  const outputDirectory = await resolveProjectPath(root, request.outputDirectory);
  const linkerConfig = await resolveProjectPath(root, request.linkerConfig);
  const sources = await Promise.all(request.sources.map(path => resolveProjectPath(root, path)));
  const includeDirectories = await Promise.all(
    (request.includeDirectories ?? []).map(path => resolveProjectPath(root, path)),
  );
  const libraries = await Promise.all((request.libraries ?? []).map(path => resolveProjectPath(root, path)));
  await mkdir(outputDirectory, {recursive: true});

  const base = `${outputDirectory}/${request.outputName}`;
  return {
    root, outputDirectory, linkerConfig, sources, includeDirectories, libraries,
    output: {
      binary: `${base}.bin`,
      prg: `${base}.prg`,
      debug: `${base}.dbg`,
      map: `${base}.map`,
      labels: `${base}.lbl`,
    },
  };
}
