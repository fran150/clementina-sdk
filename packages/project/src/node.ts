import {readFile, writeFile, realpath, lstat, mkdir, rename, rm} from 'node:fs/promises';
import {resolve, relative, dirname, isAbsolute, sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseDocument, stringify} from 'yaml';
import {assetKinds, checkAsset, type PortableAssetSet} from '@clementina/assets';
import {assertValid, diagnostic, result, ValidationError, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {checkProjectManifest, isProjectPath} from './validate.js';
import {checkProject, type PortableProject} from './project.js';

/** Reject symlinks in project paths, including dangling links and parent directories. */
export async function resolveProjectPath(root: string, path: string): Promise<string> {
  if (!isProjectPath(path)) throw new ValidationError([diagnostic('project.path', '', `Invalid project path: ${path}`)]);
  const base = await realpath(root), target = resolve(base, path);
  const rel = relative(base, target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('Path escapes project root');
  let current = base;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new ValidationError([diagnostic('project.path.symlink', '', `Symlink is not a portable project path: ${path}`)]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}
function ioDiagnostics(error: unknown, source: string): ClementinaDiagnostic[] {
  return error instanceof ValidationError ? error.diagnostics.map(d => ({...d, source})) : [{...diagnostic('project.io', '', error instanceof Error ? error.message : String(error)), source}];
}
export async function loadProject(root: string): Promise<ValidationResult<PortableProject>> {
  const diagnostics: ClementinaDiagnostic[] = [];
  let manifest;
  try {
    const text = await readFile(await resolveProjectPath(root, 'clementina.yaml'), 'utf8');
    const doc = parseDocument(text, {uniqueKeys: true});
    if (doc.errors.length) return result(undefined, doc.errors.map(e => ({...diagnostic('project.yaml', '', e.message), source: 'clementina.yaml'})));
    const r = checkProjectManifest(doc.toJS({maxAliasCount: 100}));
    if (!r.ok) return result(undefined, r.diagnostics.map(d => ({...d, source: 'clementina.yaml'})));
    manifest = r.value;
  } catch (e) { return result(undefined, ioDiagnostics(e, 'clementina.yaml')); }
  const assets: PortableAssetSet = {palettes: [], paletteConfigs: [], tilesets: [], shapes: [], animations: []};
  for (const kind of assetKinds) for (const path of manifest.assets[kind]) {
    try {
      const value = JSON.parse(await readFile(await resolveProjectPath(root, path), 'utf8'));
      const checked = checkAsset(value, kind);
      diagnostics.push(...checked.diagnostics.map(d => ({...d, source: path})));
      if (checked.ok) (assets[kind] as unknown[]).push(checked.value);
    } catch (e) { diagnostics.push(...ioDiagnostics(e, path)); }
  }
  const linkerConfig = manifest.build && 'assembly' in manifest.build && manifest.build.assembly ? [manifest.build.assembly.linkerConfig] : [];
  for (const path of new Set([manifest.program.entry, ...(manifest.program.sources ?? []), ...linkerConfig])) {
    try {
      const stat = await lstat(await resolveProjectPath(root, path));
      if (!stat.isFile()) throw Error('Program source must be a regular file');
    } catch (e) { diagnostics.push(...ioDiagnostics(e, path)); }
  }
  const includeDirectories = manifest.build && 'assembly' in manifest.build && manifest.build.assembly ? manifest.build.assembly.includeDirectories ?? [] : [];
  for (const path of includeDirectories) {
    try {
      const stat = await lstat(await resolveProjectPath(root, path));
      if (!stat.isDirectory()) throw Error('Assembly include path must be a directory');
    } catch (e) { diagnostics.push(...ioDiagnostics(e, path)); }
  }
  if (diagnostics.length) return result(undefined, diagnostics);
  const project = {manifest, assets};
  const checked = checkProject(project);
  return result(project, checked.diagnostics.map(d => {
    const match = d.path?.match(/^\/(palettes|paletteConfigs|tilesets|shapes|animations)\/(\d+)(.*)$/);
    if (!match) return {...d, source: 'clementina.yaml'};
    const kind = match[1] as keyof PortableAssetSet;
    return {...d, source: manifest.assets[kind][Number(match[2])], path: match[3]};
  }));
}

/** Validate all data/paths first; replace files atomically one at a time, manifest last.
 * Source files are owned by the caller. This is not a multi-file transaction.
 */
export async function saveProject(root: string, project: PortableProject): Promise<void> {
  assertValid(checkProject(project));
  await mkdir(root, {recursive: true});
  const files: {path: string; text: string}[] = [];
  for (const kind of assetKinds) project.assets[kind].forEach((asset, i) => files.push({path: project.manifest.assets[kind][i], text: JSON.stringify(asset, null, 2) + '\n'}));
  files.push({path: 'clementina.yaml', text: stringify(project.manifest)});
  for (const file of files) {
    const target = await resolveProjectPath(root, file.path);
    try { if (!(await lstat(target)).isFile()) throw Error(`Target is not a regular file: ${file.path}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  for (const file of files) {
    const target = await resolveProjectPath(root, file.path);
    await mkdir(dirname(target), {recursive: true});
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, file.text, {flag: 'wx'}); await rename(temporary, target); }
    finally { await rm(temporary, {force: true}); }
  }
}
