import {copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
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
import {diagnostic, result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {loadProject, resolveProjectPath} from '@clementina/project/node';
import {runtimeDirectory, runtimeIncludes, runtimeSources} from '@clementina/runtime';
import {planAssetBuild, type AssetBuildPlan} from './assets.js';

export * from './assets.js';

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

const joinPortable = (directory: string, filename: string): string => `${directory}/${filename}`;

/** Build a validated assembly or BASIC project into ROM-loadable files. */
export async function buildProject(projectRoot: string, runner: ProcessRunner = runProcess): Promise<ValidationResult<ProjectBuildResult>> {
  const loaded = await loadProject(projectRoot);
  if (!loaded.ok) return loaded as ValidationResult<ProjectBuildResult>;
  const {manifest, assets} = loaded.value;
  if (!manifest.build) return result(undefined, [diagnostic('build.configuration', '/build', 'Project has no build configuration')]);

  const config = manifest.build;
  // An asset build makes a card folder: the program, its boot program and
  // the asset files, with the load plan's paths relative to it.
  const out = config.outputDirectory;
  const card = config.assets ? joinPortable(out, 'sd') : '.';
  const onCard = (name: string) => card === '.' ? joinPortable(out, name) : joinPortable(card, name);
  const planPath = (path: string) => card === '.' ? path : path.slice(card.length + 1);
  const pending: Array<{file: GeneratedBuildFile; bytes: Uint8Array}> = [];
  const steps: MiaLoadStep[] = [];
  let warnings: ClementinaDiagnostic[] = [];
  let plan: AssetBuildPlan | undefined;
  if (config.assets) {
    const planned = planAssetBuild(loaded.value);
    if (!planned.ok) return planned as ValidationResult<ProjectBuildResult>;
    plan = planned.value;
    warnings = planned.diagnostics;
    for (const asset of plan.assets) pending.push({file: {kind: 'asset', path: joinPortable(card, asset.path), length: asset.bytes.length, assetId: asset.id}, bytes: asset.bytes});
    const text = (value: string) => new TextEncoder().encode(value);
    const inc = text(plan.assetsInc), src = text(plan.assetsS), report = text(JSON.stringify(plan.report, null, 2) + '\n');
    pending.push({file: {kind: 'asset-source', path: joinPortable(out, 'assets.inc'), length: inc.length}, bytes: inc});
    pending.push({file: {kind: 'asset-source', path: joinPortable(out, 'assets.s'), length: src.length}, bytes: src});
    pending.push({file: {kind: 'memory-report', path: joinPortable(out, 'memory-report.json'), length: report.length}, bytes: report});
  }
  const paletteConfigId = config.video?.paletteConfigId;
  if (paletteConfigId) {
    const paletteConfig = assets.paletteConfigs.find(asset => asset.id === paletteConfigId)!;
    const bytes = encodePaletteConfig(paletteConfig, assets.palettes);
    const path = onCard('asset-palette.bin');
    pending.push({file: {kind: 'palette', path, length: bytes.length, address: MIA_PALETTE_ADDRESS, assetId: paletteConfigId}, bytes});
    steps.push({kind: 'mia', path: planPath(path), address: MIA_PALETTE_ADDRESS, length: bytes.length});
  }
  for (const placement of config.video?.tilesets ?? []) {
    const tileset = assets.tilesets.find(asset => asset.id === placement.tilesetId)!;
    const bytes = encodeTileset(tileset), address = chrBankAddress(placement.bank);
    const path = onCard(`asset-chr-${placement.bank}.bin`);
    pending.push({file: {kind: 'tileset', path, length: bytes.length, address, assetId: placement.tilesetId}, bytes});
    steps.push({kind: 'mia', path: planPath(path), address, length: bytes.length});
  }

  let build: ProjectBuildResult;
  if ('assembly' in config && config.assembly) {
    const sources = [manifest.program.entry, ...(manifest.program.sources ?? [])];
    const includeDirectories = [...(config.assembly.includeDirectories ?? [])];
    const libraries: string[] = [];
    if (plan) {
      // The generated sources and the runtime must exist before ca65 runs.
      try {
        for (const item of pending.filter(item => item.file.kind === 'asset-source')) await put(projectRoot, item.file.path, item.bytes);
      } catch (error) {
        return result(undefined, [diagnostic('build.io', '', error instanceof Error ? error.message : String(error))]);
      }
      const runtime = await buildRuntime(projectRoot, joinPortable(out, 'runtime'), plan.checks, runner);
      if (!runtime.ok) return runtime as ValidationResult<ProjectBuildResult>;
      plan.report.runtimeCode = JSON.parse(await readFile(await resolveProjectPath(projectRoot, joinPortable(out, 'runtime/code-sizes.json')), 'utf8'));
      const reportFile = pending.find(item => item.file.kind === 'memory-report')!;
      reportFile.bytes = new TextEncoder().encode(JSON.stringify(plan.report, null, 2) + '\n');
      reportFile.file.length = reportFile.bytes.length;
      sources.push(joinPortable(out, 'assets.s'));
      includeDirectories.push(out, joinPortable(out, 'runtime'));
      libraries.push(runtime.value);
    }
    const assembled = await buildAssembly(projectRoot, {
      sources,
      linkerConfig: config.assembly.linkerConfig,
      outputDirectory: out,
      outputName: config.assembly.outputName,
      loadAddress: config.assembly.loadAddress,
      entrySymbol: config.assembly.entrySymbol,
      ...(config.assembly.bank === undefined ? {} : {bank: config.assembly.bank}),
      ...(includeDirectories.length ? {includeDirectories} : {}),
      ...(config.assembly.defines === undefined ? {} : {defines: config.assembly.defines}),
      ...(libraries.length ? {libraries} : {}),
    }, runner);
    if (!assembled.ok) return assembled as ValidationResult<ProjectBuildResult>;
    let loadStep = assembled.value.loadStep;
    if (plan) {
      // The program goes on the card beside its assets.
      const program = joinPortable(card, `${config.assembly.outputName.toUpperCase()}.PRG`);
      pending.push({file: {kind: 'program', path: program, length: assembled.value.prg.length}, bytes: assembled.value.prg});
      loadStep = {...loadStep, path: planPath(program)};
    }
    const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps: [...steps, loadStep]};
    const checkedPlan = checkLoadPlan(loadPlan);
    if (!checkedPlan.ok) return checkedPlan as ValidationResult<ProjectBuildResult>;
    const checkedBootstrap = checkBootstrapSource(loadPlan);
    if (!checkedBootstrap.ok) return checkedBootstrap as ValidationResult<ProjectBuildResult>;
    const bootstrapSource = checkedBootstrap.value.join('\n') + '\n';
    const bootstrapPath = joinPortable(out, 'bootstrap.bas');
    const bootstrapBytes = new TextEncoder().encode(bootstrapSource);
    pending.push({file: {kind: 'bootstrap', path: bootstrapPath, length: bootstrapBytes.length}, bytes: bootstrapBytes});
    if (plan) {
      // The card's boot program: LOAD "BOOT.BAS" and RUN, from the game's folder.
      const boot = compileBasicProgram(bootstrapSource);
      pending.push({file: {kind: 'boot', path: joinPortable(card, 'BOOT.BAS'), length: boot.length}, bytes: boot});
    }
    build = {kind: 'assembly', assembly: assembled.value, loadPlan, bootstrapSource, files: [], sdRoot: card, diagnostics: warnings, ...(plan ? {assets: plan} : {})};
  } else {
    let source: string, bytes: Uint8Array;
    try {
      source = await readFile(await resolveProjectPath(projectRoot, manifest.program.entry), 'utf8');
      bytes = compileBasicProgram(source);
    } catch (error) {
      return result(undefined, [{...diagnostic('basic.compile', '', error instanceof Error ? error.message : String(error)), source: manifest.program.entry}]);
    }
    const artifact = joinPortable(out, `${config.basic!.outputName}.bas`);
    const basicStep: BasicLoadStep = {kind: 'basic', path: artifact, length: bytes.length};
    const loadPlan: LoadPlan = {format: 'clementina-load-plan', version: 1, steps: [...steps, basicStep]};
    const checkedLaunch = checkLoadPlanLaunch(loadPlan);
    if (!checkedLaunch.ok) return checkedLaunch as ValidationResult<ProjectBuildResult>;
    const lines = inspectBasicProgram(bytes).lines.length;
    pending.push({file: {kind: 'basic', path: artifact, length: bytes.length}, bytes});
    build = {kind: 'basic', basic: {source: manifest.program.entry, artifact, bytes, lines}, loadPlan, files: [], sdRoot: card, diagnostics: warnings};
  }

  const planBytes = new TextEncoder().encode(JSON.stringify(build.loadPlan, null, 2) + '\n');
  pending.push({file: {kind: 'load-plan', path: joinPortable(out, 'load-plan.json'), length: planBytes.length}, bytes: planBytes});
  try {
    for (const item of pending) await put(projectRoot, item.file.path, item.bytes);
  } catch (error) {
    return result(undefined, [diagnostic('build.io', '', error instanceof Error ? error.message : String(error))]);
  }
  build.files = pending.map(item => item.file);
  return result(build, warnings);
}

async function put(projectRoot: string, path: string, bytes: Uint8Array): Promise<void> {
  const target = await resolveProjectPath(projectRoot, path);
  await mkdir(dirname(target), {recursive: true});
  await writeFile(target, bytes);
}

/** Counts emitted bytes in ca65's CODE listing, including continuation rows. */
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
 * runtime.lib there. Returns the library's project-relative path.
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
    return result(undefined, [diagnostic('build.runtime', '', error instanceof Error ? error.message : String(error))]);
  }
}
