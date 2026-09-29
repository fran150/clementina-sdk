import {writeFile} from 'node:fs/promises';
import {encodePrg, type PrgLoadStep} from '@clementina/basic';
import {diagnostic, errorMessage, result, type ValidationResult} from '@clementina/core';
import {prepareBuildPaths, projectRelativePath, type BuildPaths} from './build-paths.js';
import {readLinkedImage, verifyLinkedImage, type LinkedImage} from './linked-image.js';
import {runProcess} from './process.js';
import {assembleSources, linkImage, type AssembledSources} from './toolchain.js';
import type {AssemblyBuildRequest, AssemblyBuildResult, ProcessRunner} from './types.js';
import {validateRequest} from './validation.js';

/**
 * Encode and write the verified image, then describe its portable artifacts.
 *
 * @param paths - Resolved locations for build outputs.
 * @param request - Build request supplying the load address and optional bank.
 * @param image - Linked binary and parsed debug records.
 * @param entryAddress - Verified address of the entry symbol.
 * @param assembled - Object and listing paths from ca65.
 * @returns The completed build or a PRG encoding diagnostic.
 */
async function writeBuildResult(
  paths: BuildPaths,
  request: AssemblyBuildRequest,
  image: LinkedImage,
  entryAddress: number,
  assembled: AssembledSources,
): Promise<ValidationResult<AssemblyBuildResult>> {
  let prg: Uint8Array;
  try {
    prg = encodePrg(image.binary, request.loadAddress, request.bank);
  } catch (error) {
    return result<AssemblyBuildResult>(undefined, [
      diagnostic('assembler.prg', '', errorMessage(error)),
    ]);
  }
  await writeFile(paths.output.prg, prg);

  /**
   * Express an artifact path relative to this build's project root.
   *
   * @param path - Absolute artifact path.
   * @returns Portable project-relative path.
   */
  const relativePath = (path: string): string => projectRelativePath(paths.root, path);
  const loadStep: PrgLoadStep = {
    kind: 'prg',
    path: relativePath(paths.output.prg),
    loadAddress: request.loadAddress,
    length: image.binary.length,
    ...(request.bank === undefined ? {} : {bank: request.bank}),
    runAddress: entryAddress,
  };
  return result<AssemblyBuildResult>({
    binary: image.binary,
    prg,
    loadStep,
    entryAddress,
    debug: image.debug,
    artifacts: {
      binary: relativePath(paths.output.binary),
      prg: relativePath(paths.output.prg),
      debug: relativePath(paths.output.debug),
      map: relativePath(paths.output.map),
      labels: relativePath(paths.output.labels),
      objects: assembled.objects.map(relativePath),
      listings: assembled.listings.map(relativePath),
    },
  }, []);
}

/**
 * Assemble, link, verify placement, and package a contiguous Clementina PRG.
 *
 * @param projectRoot - Directory containing the sources and linker configuration.
 * @param request - Explicit sources, output paths, load address, and entry symbol.
 * @param runner - Process runner; defaults to spawning ca65 and ld65 without a shell.
 * @returns Build artifacts on success or structured diagnostics on failure.
 */
export async function buildAssembly(
  projectRoot: string,
  request: AssemblyBuildRequest,
  runner: ProcessRunner = runProcess,
): Promise<ValidationResult<AssemblyBuildResult>> {
  const diagnostics = validateRequest(request);
  if (diagnostics.length) return result(undefined, diagnostics);

  try {
    const paths = await prepareBuildPaths(projectRoot, request);
    const assembled = await assembleSources(paths, request, runner);
    if (!assembled.ok) return assembled;

    const linkFailure = await linkImage(paths, request, assembled.value.objects, runner);
    if (linkFailure) return result(undefined, [linkFailure]);

    const image = await readLinkedImage(paths);
    const entry = verifyLinkedImage(paths, request, image);
    if (!entry.ok) return entry;

    return await writeBuildResult(paths, request, image, entry.value, assembled.value);
  } catch (error) {
    return result(undefined, [
      diagnostic('assembler.io', '', errorMessage(error)),
    ]);
  }
}
