import {writeFile} from 'node:fs/promises';
import {buildAssembly, runProcess, type AssemblyBuildResult, type ProcessRunner} from '@clementina/assembler';
import {chrBankAddress, encodePaletteConfig, encodeTileset, MIA_PALETTE_ADDRESS} from '@clementina/assets';
import {checkBootstrapSource, checkLoadPlan, type LoadPlan, type MiaLoadStep} from '@clementina/basic';
import {diagnostic, result, type ValidationResult} from '@clementina/core';
import {loadProject, resolveProjectPath} from '@clementina/project/node';

export interface GeneratedBuildFile {
  kind: 'palette' | 'tileset' | 'load-plan' | 'bootstrap';
  path: string;
  length: number;
  address?: number;
  assetId?: string;
}

export interface ProjectBuildResult {
  assembly: AssemblyBuildResult;
  loadPlan: LoadPlan;
  bootstrapSource: string;
  files: GeneratedBuildFile[];
}

const joinPortable = (directory: string, filename: string): string => `${directory}/${filename}`;

/** Build a validated project into ROM-loadable files and a BASIC bootstrap plan. */
export async function buildProject(projectRoot: string, runner: ProcessRunner = runProcess): Promise<ValidationResult<ProjectBuildResult>> {
  const loaded = await loadProject(projectRoot);
  if (!loaded.ok) return loaded as ValidationResult<ProjectBuildResult>;
  const {manifest, assets} = loaded.value;
  if (!manifest.build) return result(undefined, [diagnostic('build.configuration', '/build', 'Project has no build configuration')]);

  const config = manifest.build;
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

  const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps: [...steps, assembled.value.loadStep]};
  const checkedPlan = checkLoadPlan(loadPlan);
  if (!checkedPlan.ok) return checkedPlan as ValidationResult<ProjectBuildResult>;
  const checkedBootstrap = checkBootstrapSource(loadPlan);
  if (!checkedBootstrap.ok) return checkedBootstrap as ValidationResult<ProjectBuildResult>;
  const bootstrapSource = checkedBootstrap.value.join('\n') + '\n';
  const planPath = joinPortable(config.outputDirectory, 'load-plan.json');
  const bootstrapPath = joinPortable(config.outputDirectory, 'bootstrap.bas');

  try {
    for (const item of pending) await writeFile(await resolveProjectPath(projectRoot, item.file.path), item.bytes);
    await writeFile(await resolveProjectPath(projectRoot, planPath), JSON.stringify(loadPlan, null, 2) + '\n');
    await writeFile(await resolveProjectPath(projectRoot, bootstrapPath), bootstrapSource);
  } catch (error) {
    return result(undefined, [diagnostic('build.io', '', error instanceof Error ? error.message : String(error))]);
  }
  const files: GeneratedBuildFile[] = [
    ...pending.map(item => item.file),
    {kind: 'load-plan', path: planPath, length: new TextEncoder().encode(JSON.stringify(loadPlan, null, 2) + '\n').length},
    {kind: 'bootstrap', path: bootstrapPath, length: new TextEncoder().encode(bootstrapSource).length},
  ];
  return result({assembly: assembled.value, loadPlan, bootstrapSource, files}, []);
}
