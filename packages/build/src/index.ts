import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {buildAssembly, runProcess, type AssemblyBuildResult, type ProcessRunner} from '@clementina/assembler';
import {chrBankAddress, encodePaletteConfig, encodeTileset, MIA_PALETTE_ADDRESS} from '@clementina/assets';
import {
  checkBootstrapSource, checkLoadPlan, checkLoadPlanLaunch, compileBasicProgram, inspectBasicProgram,
  type BasicLoadStep, type LoadPlan, type MiaLoadStep,
} from '@clementina/basic';
import {diagnostic, errorMessage, result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import type {PortableProject, ProjectAssemblyBuild} from '@clementina/project';
import {loadProject, resolveProjectPath} from '@clementina/project/node';
import {planAssetBuild, type AssetBuildPlan} from './assets.js';
import {buildRuntime} from './runtime-build.js';
import {cardFile, joinPortable, loadPath, type BuildPaths} from './build-paths.js';

export * from './assets.js';
export {buildRuntime, runtimeCodeSize} from './runtime-build.js';

export interface GeneratedBuildFile {
  kind: 'palette' | 'tileset' | 'basic' | 'load-plan' | 'bootstrap' | 'boot' | 'program' | 'asset' | 'asset-source' | 'memory-report';
  path: string;
  length: number;
  address?: number;
  assetId?: string;
}

interface CommonProjectBuildResult {
  loadPlan: LoadPlan;
  files: GeneratedBuildFile[];
  /** Project-relative folder to use as the SD card: the load plan's paths are relative to it. */
  sdRoot: string;
  /** Warnings from the asset build. */
  diagnostics: ClementinaDiagnostic[];
  assets?: AssetBuildPlan;
}
export interface AssemblyProjectBuildResult extends CommonProjectBuildResult {
  kind: 'assembly';
  assembly: AssemblyBuildResult;
  bootstrapSource: string;
}
export interface BasicProjectBuildResult extends CommonProjectBuildResult {
  kind: 'basic';
  basic: {source: string; artifact: string; bytes: Uint8Array; lines: number};
}
export type ProjectBuildResult = AssemblyProjectBuildResult | BasicProjectBuildResult;

interface PendingBuildFile {file: GeneratedBuildFile; bytes: Uint8Array}
interface BuildState {
  projectRoot: string;
  project: PortableProject;
  paths: BuildPaths;
  pending: PendingBuildFile[];
  videoSteps: MiaLoadStep[];
  warnings: ClementinaDiagnostic[];
  assetPlan?: AssetBuildPlan;
}

/** Encode generated text as UTF-8 bytes. */
function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Queue an output and record its byte length once. */
function stage(state: BuildState, kind: GeneratedBuildFile['kind'], path: string, bytes: Uint8Array, details: Pick<GeneratedBuildFile, 'address' | 'assetId'> = {}): void {
  state.pending.push({file: {kind, path, length: bytes.length, ...details}, bytes});
}

/** Queue the encoded assets, generated ca65 sources, and initial memory report. */
function stageAssetFiles(state: BuildState, plan: AssetBuildPlan): void {
  for (const asset of plan.assets) stage(state, 'asset', joinPortable(state.paths.cardRoot, asset.path), asset.bytes, {assetId: asset.id});
  const out = state.paths.outputDirectory;
  stage(state, 'asset-source', joinPortable(out, 'assets.inc'), utf8Bytes(plan.assetsInc));
  stage(state, 'asset-source', joinPortable(out, 'assets.s'), utf8Bytes(plan.assetsS));
  stage(state, 'memory-report', joinPortable(out, 'memory-report.json'), utf8Bytes(JSON.stringify(plan.report, null, 2) + '\n'));
}

/** Queue explicit video placements and their MIA load steps. */
function stageVideoFiles(state: BuildState): void {
  const {manifest, assets} = state.project;
  const paletteConfigId = manifest.build?.video?.paletteConfigId;
  if (paletteConfigId) {
    const palette = assets.paletteConfigs.find(asset => asset.id === paletteConfigId)!;
    const bytes = encodePaletteConfig(palette, assets.palettes);
    const path = cardFile(state.paths, 'asset-palette.bin');
    stage(state, 'palette', path, bytes, {address: MIA_PALETTE_ADDRESS, assetId: paletteConfigId});
    state.videoSteps.push({kind: 'mia', path: loadPath(state.paths, path), address: MIA_PALETTE_ADDRESS, length: bytes.length});
  }
  for (const placement of manifest.build?.video?.tilesets ?? []) {
    const tileset = assets.tilesets.find(asset => asset.id === placement.tilesetId)!;
    const bytes = encodeTileset(tileset);
    const address = chrBankAddress(placement.bank);
    const path = cardFile(state.paths, `asset-chr-${placement.bank}.bin`);
    stage(state, 'tileset', path, bytes, {address, assetId: placement.tilesetId});
    state.videoSteps.push({kind: 'mia', path: loadPath(state.paths, path), address, length: bytes.length});
  }
}

/** Write a staged file through the project's portable-path guard. */
async function writeStagedFile(projectRoot: string, item: PendingBuildFile): Promise<void> {
  const target = await resolveProjectPath(projectRoot, item.file.path);
  await mkdir(dirname(target), {recursive: true});
  await writeFile(target, item.bytes);
}

/** Replace the initial report with code sizes collected by the runtime build. */
async function updateRuntimeReport(state: BuildState): Promise<void> {
  const plan = state.assetPlan!;
  const reportPath = joinPortable(state.paths.outputDirectory, 'runtime/code-sizes.json');
  plan.report.runtimeCode = JSON.parse(await readFile(await resolveProjectPath(state.projectRoot, reportPath), 'utf8'));
  const reportFile = state.pending.find(item => item.file.kind === 'memory-report')!;
  reportFile.bytes = utf8Bytes(JSON.stringify(plan.report, null, 2) + '\n');
  reportFile.file.length = reportFile.bytes.length;
}

/** Assemble a project, validate its launch plan, and stage its boot artifacts. */
async function buildAssemblyProject(state: BuildState, config: ProjectAssemblyBuild, runner: ProcessRunner): Promise<ValidationResult<AssemblyProjectBuildResult>> {
  const {projectRoot, project, paths, assetPlan: plan} = state;
  const sources = [project.manifest.program.entry, ...(project.manifest.program.sources ?? [])];
  const includeDirectories = [...(config.includeDirectories ?? [])];
  const libraries: string[] = [];
  if (plan) {
    // ca65 needs generated sources and runtime files before the final output pass.
    try {
      for (const item of state.pending.filter(item => item.file.kind === 'asset-source')) await writeStagedFile(projectRoot, item);
    } catch (error) {
      return result(undefined, [diagnostic('build.io', '', errorMessage(error))]);
    }
    const runtime = await buildRuntime(projectRoot, joinPortable(paths.outputDirectory, 'runtime'), plan.checks, runner);
    if (!runtime.ok) return runtime as ValidationResult<AssemblyProjectBuildResult>;
    await updateRuntimeReport(state);
    sources.push(joinPortable(paths.outputDirectory, 'assets.s'));
    includeDirectories.push(paths.outputDirectory, joinPortable(paths.outputDirectory, 'runtime'));
    libraries.push(runtime.value);
  }
  const assembled = await buildAssembly(projectRoot, {
    sources,
    linkerConfig: config.linkerConfig,
    outputDirectory: paths.outputDirectory,
    outputName: config.outputName,
    loadAddress: config.loadAddress,
    entrySymbol: config.entrySymbol,
    ...(config.bank === undefined ? {} : {bank: config.bank}),
    ...(includeDirectories.length ? {includeDirectories} : {}),
    ...(config.defines === undefined ? {} : {defines: config.defines}),
    ...(libraries.length ? {libraries} : {}),
  }, runner);
  if (!assembled.ok) return assembled as ValidationResult<AssemblyProjectBuildResult>;
  let programStep = assembled.value.loadStep;
  if (plan) {
    const program = cardFile(paths, `${config.outputName.toUpperCase()}.PRG`);
    stage(state, 'program', program, assembled.value.prg);
    programStep = {...programStep, path: loadPath(paths, program)};
  }
  const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps: [...state.videoSteps, programStep]};
  const checkedPlan = checkLoadPlan(loadPlan);
  if (!checkedPlan.ok) return checkedPlan as ValidationResult<AssemblyProjectBuildResult>;
  const checkedBootstrap = checkBootstrapSource(loadPlan);
  if (!checkedBootstrap.ok) return checkedBootstrap as ValidationResult<AssemblyProjectBuildResult>;
  const bootstrapSource = checkedBootstrap.value.join('\n') + '\n';
  stage(state, 'bootstrap', joinPortable(paths.outputDirectory, 'bootstrap.bas'), utf8Bytes(bootstrapSource));
  if (plan) stage(state, 'boot', cardFile(paths, 'BOOT.BAS'), compileBasicProgram(bootstrapSource));
  return result({kind: 'assembly', assembly: assembled.value, loadPlan, bootstrapSource, files: [], sdRoot: paths.cardRoot,
    diagnostics: state.warnings, ...(plan ? {assets: plan} : {})}, []);
}

/** Compile the BASIC entry source and stage its direct-launch artifact. */
async function buildBasicProject(state: BuildState, outputName: string): Promise<ValidationResult<BasicProjectBuildResult>> {
  const sourcePath = state.project.manifest.program.entry;
  let bytes: Uint8Array;
  try {
    const source = await readFile(await resolveProjectPath(state.projectRoot, sourcePath), 'utf8');
    bytes = compileBasicProgram(source);
  } catch (error) {
    return result(undefined, [{...diagnostic('basic.compile', '', errorMessage(error)), source: sourcePath}]);
  }
  const artifact = joinPortable(state.paths.outputDirectory, `${outputName}.bas`);
  const basicStep: BasicLoadStep = {kind: 'basic', path: artifact, length: bytes.length};
  const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps: [...state.videoSteps, basicStep]};
  const checkedLaunch = checkLoadPlanLaunch(loadPlan);
  if (!checkedLaunch.ok) return checkedLaunch as ValidationResult<BasicProjectBuildResult>;
  stage(state, 'basic', artifact, bytes);
  return result({kind: 'basic', basic: {source: sourcePath, artifact, bytes, lines: inspectBasicProgram(bytes).lines.length},
    loadPlan, files: [], sdRoot: state.paths.cardRoot, diagnostics: state.warnings}, []);
}

/**
 * Load and validate a portable project, then build ROM-loadable files.
 *
 * @param projectRoot - Directory containing `clementina.yaml` and its sources.
 * @param runner - Optional runner for ca65, ld65, and ar65 commands.
 * @returns Generated file metadata and launch plan, or validation/build diagnostics.
 * A failed assembly build may leave intermediate tool output in the build folder.
 */
export async function buildProject(projectRoot: string, runner: ProcessRunner = runProcess): Promise<ValidationResult<ProjectBuildResult>> {
  const loaded = await loadProject(projectRoot);
  if (!loaded.ok) return loaded as ValidationResult<ProjectBuildResult>;
  const config = loaded.value.manifest.build;
  if (!config) return result(undefined, [diagnostic('build.configuration', '/build', 'Project has no build configuration')]);

  const paths: BuildPaths = {outputDirectory: config.outputDirectory, cardRoot: config.assets ? joinPortable(config.outputDirectory, 'sd') : '.'};
  const state: BuildState = {projectRoot, project: loaded.value, paths, pending: [], videoSteps: [], warnings: []};
  if (config.assets) {
    const planned = planAssetBuild(loaded.value);
    if (!planned.ok) return planned as ValidationResult<ProjectBuildResult>;
    state.assetPlan = planned.value;
    state.warnings = planned.diagnostics;
    stageAssetFiles(state, planned.value);
  }
  stageVideoFiles(state);
  const built = 'assembly' in config && config.assembly
    ? await buildAssemblyProject(state, config.assembly, runner)
    : await buildBasicProject(state, config.basic!.outputName);
  if (!built.ok) return built as ValidationResult<ProjectBuildResult>;

  stage(state, 'load-plan', joinPortable(paths.outputDirectory, 'load-plan.json'), utf8Bytes(JSON.stringify(built.value.loadPlan, null, 2) + '\n'));
  try {
    for (const item of state.pending) await writeStagedFile(projectRoot, item);
  } catch (error) {
    return result(undefined, [diagnostic('build.io', '', errorMessage(error))]);
  }
  built.value.files = state.pending.map(item => item.file);
  return result(built.value, state.warnings);
}
