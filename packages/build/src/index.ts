import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {buildAssembly, runProcess, type AssemblyBuildResult, type ProcessRunner} from '@clementina/assembler';
import {chrBankAddress, encodePaletteConfig, encodeTileset, MIA_PALETTE_ADDRESS} from '@clementina/assets';
import {
  checkBootstrapSource, checkLoadPlanLaunch, compileBasicProgram, inspectBasicProgram,
  type BasicLoadStep, type LoadPlan, type LoadStep, type MiaLoadStep, type PrgLoadStep,
} from '@clementina/basic';
import {diagnostic, errorMessage, result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import type {PortableProject, ProjectAssemblyBuild, ProjectBasicBuild} from '@clementina/project';
import {loadProject, resolveProjectPath} from '@clementina/project/node';
import {planAssetBuild, type AssetBuildPlan} from './assets.js';
import {buildRuntime, writeSystemIncludes} from './runtime-build.js';
import {cardFile, joinPortable, loadPath, type BuildPaths} from './build-paths.js';
import {memoryLayout, type MemoryLayout} from './memory-layout.js';

export * from './assets.js';
export * from './memory-layout.js';
export {buildRuntime, runtimeCodeSize, writeSystemIncludes} from './runtime-build.js';

export interface GeneratedBuildFile {
  kind: 'palette' | 'tileset' | 'basic' | 'load-plan' | 'bootstrap' | 'boot' | 'program' | 'asset' | 'asset-source' | 'memory-report' | 'memory-layout';
  path: string;
  length: number;
  address?: number;
  assetId?: string;
}

/**
 * A built project. It has the parts its manifest declares: `assembly` for
 * build.assembly, `basic` for program.entry, or both, in which case the PRG is
 * BLOADed and the BASIC program runs last and calls it.
 */
export interface ProjectBuildResult {
  loadPlan: LoadPlan;
  files: GeneratedBuildFile[];
  /** Project-relative folder to use as the SD card: the load plan's paths are relative to it. */
  sdRoot: string;
  /** Warnings from the asset build and the memory layout. */
  diagnostics: ClementinaDiagnostic[];
  /** The numbered loader written to bootstrap.bas (and BOOT.BAS on a card). */
  bootstrapSource: string;
  /** Where every part lands in CPU memory and MIA RAM, written to memory-layout.json. */
  memoryLayout: MemoryLayout;
  assets?: AssetBuildPlan;
  assembly?: AssemblyBuildResult;
  basic?: {source: string; artifact: string; bytes: Uint8Array; lines: number};
}
type BuiltParts = Pick<ProjectBuildResult, 'assembly' | 'basic'>;

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

/** Assemble build.assembly into a PRG and return its load step. */
async function buildAssemblyPart(state: BuildState, config: ProjectAssemblyBuild, runner: ProcessRunner): Promise<ValidationResult<{assembly: AssemblyBuildResult; step: PrgLoadStep}>> {
  const {projectRoot, paths, assetPlan: plan} = state;
  const sources = [...config.sources];
  // The project's own include directories come first, so a program can override the generated ones.
  const system = await writeSystemIncludes(projectRoot, joinPortable(paths.outputDirectory, 'include'));
  if (!system.ok) return system as ValidationResult<never>;
  const includeDirectories = [...(config.includeDirectories ?? []), system.value];
  const libraries: string[] = [];
  if (plan) {
    // ca65 needs generated sources and runtime files before the final output pass.
    try {
      for (const item of state.pending.filter(item => item.file.kind === 'asset-source')) await writeStagedFile(projectRoot, item);
    } catch (error) {
      return result(undefined, [diagnostic('build.io', '', errorMessage(error))]);
    }
    const runtime = await buildRuntime(projectRoot, joinPortable(paths.outputDirectory, 'runtime'), plan.checks, runner);
    if (!runtime.ok) return runtime as ValidationResult<never>;
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
    includeDirectories,
    ...(config.defines === undefined ? {} : {defines: config.defines}),
    ...(libraries.length ? {libraries} : {}),
  }, runner);
  if (!assembled.ok) return assembled as ValidationResult<never>;
  let step = assembled.value.loadStep;
  if (plan) {
    const program = cardFile(paths, `${config.outputName.toUpperCase()}.PRG`);
    stage(state, 'program', program, assembled.value.prg);
    step = {...step, path: loadPath(paths, program)};
  }
  return result({assembly: assembled.value, step}, []);
}

/** Compile program.entry and return its terminal load step. */
async function buildBasicPart(state: BuildState, config: ProjectBasicBuild): Promise<ValidationResult<{basic: NonNullable<ProjectBuildResult['basic']>; step: BasicLoadStep}>> {
  const sourcePath = state.project.manifest.program!.entry;
  let bytes: Uint8Array;
  try {
    const source = await readFile(await resolveProjectPath(state.projectRoot, sourcePath), 'utf8');
    bytes = compileBasicProgram(source);
  } catch (error) {
    return result(undefined, [{...diagnostic('basic.compile', '', errorMessage(error)), source: sourcePath}]);
  }
  const artifact = state.assetPlan
    ? cardFile(state.paths, `${config.outputName.toUpperCase()}.BAS`)
    : joinPortable(state.paths.outputDirectory, `${config.outputName}.bas`);
  stage(state, 'basic', artifact, bytes);
  return result({
    basic: {source: sourcePath, artifact, bytes, lines: inspectBasicProgram(bytes).lines.length},
    step: {kind: 'basic', path: loadPath(state.paths, artifact), length: bytes.length},
  }, []);
}

/**
 * Build each declared part and combine them into one load plan: MEMSIZ, the
 * video and asset loads, the PRG, then the BASIC program. Without a BASIC
 * program the PRG is the terminal BRUN step; with one, it is BLOADed and returns.
 */
async function buildParts(state: BuildState, runner: ProcessRunner): Promise<ValidationResult<{parts: BuiltParts; loadPlan: LoadPlan; bootstrapSource: string}>> {
  const config = state.project.manifest.build!;
  const parts: BuiltParts = {};
  const steps: LoadStep[] = [];
  if (config.basic?.memoryTop !== undefined) steps.push({kind: 'memoryTop', address: config.basic.memoryTop});
  steps.push(...state.videoSteps);
  if (config.assembly) {
    const built = await buildAssemblyPart(state, config.assembly, runner);
    if (!built.ok) return built as ValidationResult<never>;
    parts.assembly = built.value.assembly;
    const {runAddress, ...returning} = built.value.step;
    steps.push(state.project.manifest.program ? returning : {...returning, runAddress});
  }
  if (state.project.manifest.program) {
    const built = await buildBasicPart(state, config.basic!);
    if (!built.ok) return built as ValidationResult<never>;
    parts.basic = built.value.basic;
    steps.push(built.value.step);
  }
  const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps};
  const checkedLaunch = checkLoadPlanLaunch(loadPlan);
  if (!checkedLaunch.ok) return checkedLaunch as ValidationResult<never>;
  const checkedBootstrap = checkBootstrapSource(loadPlan);
  if (!checkedBootstrap.ok) return checkedBootstrap as ValidationResult<never>;
  const bootstrapSource = checkedBootstrap.value.join('\n') + '\n';
  stage(state, 'bootstrap', joinPortable(state.paths.outputDirectory, 'bootstrap.bas'), utf8Bytes(bootstrapSource));
  if (state.assetPlan) stage(state, 'boot', cardFile(state.paths, 'BOOT.BAS'), compileBasicProgram(bootstrapSource));
  return result({parts, loadPlan, bootstrapSource}, []);
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
  const built = await buildParts(state, runner);
  if (!built.ok) return built as ValidationResult<ProjectBuildResult>;
  const {parts, loadPlan, bootstrapSource} = built.value;
  const layout = memoryLayout({loadPlan, returnsToBasic: parts.basic !== undefined, ...(state.assetPlan ? {assets: state.assetPlan} : {})});
  state.warnings = [...state.warnings, ...layout.diagnostics];

  stage(state, 'load-plan', joinPortable(paths.outputDirectory, 'load-plan.json'), utf8Bytes(JSON.stringify(loadPlan, null, 2) + '\n'));
  stage(state, 'memory-layout', joinPortable(paths.outputDirectory, 'memory-layout.json'), utf8Bytes(JSON.stringify(layout, null, 2) + '\n'));
  try {
    for (const item of state.pending) await writeStagedFile(projectRoot, item);
  } catch (error) {
    return result(undefined, [diagnostic('build.io', '', errorMessage(error))]);
  }
  return result({
    loadPlan, bootstrapSource, memoryLayout: layout, sdRoot: paths.cardRoot, diagnostics: state.warnings,
    files: state.pending.map(item => item.file), ...parts, ...(state.assetPlan ? {assets: state.assetPlan} : {}),
  }, state.warnings);
}
