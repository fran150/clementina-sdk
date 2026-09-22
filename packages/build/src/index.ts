import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {buildAssembly, runProcess, type AssemblyBuildResult, type ProcessRunner} from '@clementina/assembler';
import {chrBankAddress, encodePaletteConfig, encodeTileset, MIA_PALETTE_ADDRESS} from '@clementina/assets';
import {
  checkBootstrapSource,
  checkLoadPlan,
  checkLoadPlanLaunch,
  compileBasicProgram,
  inspectBasicProgram,
  type BasicLoadStep,
  type LoadPlan,
  type MiaLoadStep,
} from '@clementina/basic';
import {diagnostic, result, type ValidationResult} from '@clementina/core';
import {loadProject, resolveProjectPath} from '@clementina/project/node';

export interface GeneratedBuildFile {
  kind: 'palette' | 'tileset' | 'basic' | 'load-plan' | 'bootstrap';
  path: string;
  length: number;
  address?: number;
  assetId?: string;
}

interface CommonProjectBuildResult {loadPlan: LoadPlan; files: GeneratedBuildFile[]}
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

const joinPortable = (directory: string, filename: string): string => `${directory}/${filename}`;

/** Build a validated assembly or BASIC project into ROM-loadable files. */
export async function buildProject(projectRoot: string, runner: ProcessRunner = runProcess): Promise<ValidationResult<ProjectBuildResult>> {
  const loaded = await loadProject(projectRoot);
  if (!loaded.ok) return loaded as ValidationResult<ProjectBuildResult>;
  const {manifest, assets} = loaded.value;
  if (!manifest.build) return result(undefined, [diagnostic('build.configuration', '/build', 'Project has no build configuration')]);

  const config = manifest.build;
  const pending: Array<{file: GeneratedBuildFile; bytes: Uint8Array}> = [];
  const steps: MiaLoadStep[] = [];
  const paletteConfigId = config.video?.paletteConfigId;
  if (paletteConfigId) {
    const paletteConfig = assets.paletteConfigs.find(asset => asset.id === paletteConfigId)!;
    const bytes = encodePaletteConfig(paletteConfig, assets.palettes);
    const path = joinPortable(config.outputDirectory, 'asset-palette.bin');
    pending.push({file: {kind: 'palette', path, length: bytes.length, address: MIA_PALETTE_ADDRESS, assetId: paletteConfigId}, bytes});
    steps.push({kind: 'mia', path, address: MIA_PALETTE_ADDRESS, length: bytes.length});
  }
  for (const placement of config.video?.tilesets ?? []) {
    const tileset = assets.tilesets.find(asset => asset.id === placement.tilesetId)!;
    const bytes = encodeTileset(tileset), address = chrBankAddress(placement.bank);
    const path = joinPortable(config.outputDirectory, `asset-chr-${placement.bank}.bin`);
    pending.push({file: {kind: 'tileset', path, length: bytes.length, address, assetId: placement.tilesetId}, bytes});
    steps.push({kind: 'mia', path, address, length: bytes.length});
  }

  let build: ProjectBuildResult;
  if ('assembly' in config && config.assembly) {
    const assembled = await buildAssembly(projectRoot, {
      sources: [manifest.program.entry, ...(manifest.program.sources ?? [])],
      linkerConfig: config.assembly.linkerConfig,
      outputDirectory: config.outputDirectory,
      outputName: config.assembly.outputName,
      loadAddress: config.assembly.loadAddress,
      entrySymbol: config.assembly.entrySymbol,
      ...(config.assembly.bank === undefined ? {} : {bank: config.assembly.bank}),
      ...(config.assembly.includeDirectories === undefined ? {} : {includeDirectories: config.assembly.includeDirectories}),
      ...(config.assembly.defines === undefined ? {} : {defines: config.assembly.defines}),
    }, runner);
    if (!assembled.ok) return assembled as ValidationResult<ProjectBuildResult>;
    const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps: [...steps, assembled.value.loadStep]};
    const checkedPlan = checkLoadPlan(loadPlan);
    if (!checkedPlan.ok) return checkedPlan as ValidationResult<ProjectBuildResult>;
    const checkedBootstrap = checkBootstrapSource(loadPlan);
    if (!checkedBootstrap.ok) return checkedBootstrap as ValidationResult<ProjectBuildResult>;
    const bootstrapSource = checkedBootstrap.value.join('\n') + '\n';
    const bootstrapPath = joinPortable(config.outputDirectory, 'bootstrap.bas');
    const bootstrapBytes = new TextEncoder().encode(bootstrapSource);
    pending.push({file: {kind: 'bootstrap', path: bootstrapPath, length: bootstrapBytes.length}, bytes: bootstrapBytes});
    build = {kind: 'assembly', assembly: assembled.value, loadPlan, bootstrapSource, files: []};
  } else {
    let source: string, bytes: Uint8Array;
    try {
      source = await readFile(await resolveProjectPath(projectRoot, manifest.program.entry), 'utf8');
      bytes = compileBasicProgram(source);
    } catch (error) {
      return result(undefined, [{...diagnostic('basic.compile', '', error instanceof Error ? error.message : String(error)), source: manifest.program.entry}]);
    }
    const artifact = joinPortable(config.outputDirectory, `${config.basic!.outputName}.bas`);
    const basicStep: BasicLoadStep = {kind: 'basic', path: artifact, length: bytes.length};
    const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps: [...steps, basicStep]};
    const checkedLaunch = checkLoadPlanLaunch(loadPlan);
    if (!checkedLaunch.ok) return checkedLaunch as ValidationResult<ProjectBuildResult>;
    const lines = inspectBasicProgram(bytes).lines.length;
    pending.push({file: {kind: 'basic', path: artifact, length: bytes.length}, bytes});
    build = {kind: 'basic', basic: {source: manifest.program.entry, artifact, bytes, lines}, loadPlan, files: []};
  }

  const planPath = joinPortable(config.outputDirectory, 'load-plan.json');
  const planBytes = new TextEncoder().encode(JSON.stringify(build.loadPlan, null, 2) + '\n');
  pending.push({file: {kind: 'load-plan', path: planPath, length: planBytes.length}, bytes: planBytes});
  try {
    for (const item of pending) {
      const target = await resolveProjectPath(projectRoot, item.file.path);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, item.bytes);
    }
  } catch (error) {
    return result(undefined, [diagnostic('build.io', '', error instanceof Error ? error.message : String(error))]);
  }
  build.files = pending.map(item => item.file);
  return result(build, []);
}
