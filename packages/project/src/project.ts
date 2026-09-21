import {assetKinds, checkAssetSet, type AssetKind, type PortableAsset, type PortableAssetSet} from '@clementina/assets';
import {assertValid, diagnostic, result, type ValidationResult} from '@clementina/core';
import {checkProjectManifest} from './validate.js';
import type {ClementinaProjectManifest} from './types.js';
export interface PortableProject { manifest: ClementinaProjectManifest; assets: PortableAssetSet }
export function checkProject(value: PortableProject): ValidationResult<PortableProject> {
  const m = checkProjectManifest(value.manifest), a = checkAssetSet(value.assets);
  const diagnostics = [...m.diagnostics, ...a.diagnostics];
  if (m.ok && a.ok) {
    const sources = new Set([m.value.program.entry, ...(m.value.program.sources ?? []), 'clementina.yaml']);
    const destinations = [...sources, ...assetKinds.flatMap(kind => m.value.assets[kind])];
    for (const path of destinations) {
      if (destinations.some(other => other !== path && other.startsWith(path + "/"))) diagnostics.push(diagnostic("project.path.collision", "/assets", `A file is also used as a directory: ${path}`));
    }
    for (const kind of assetKinds) {
      if (m.value.assets[kind].length !== a.value[kind].length) diagnostics.push(diagnostic('project.asset.count', `/assets/${kind}`, 'Paths and assets must have matching lengths'));
      m.value.assets[kind].forEach((path, i) => {
        if (sources.has(path)) diagnostics.push(diagnostic('project.path.collision', `/assets/${kind}/${i}`, 'An asset cannot overwrite a source or manifest'));
      });
    }
  }
  return result(value, diagnostics);
}
/** IDs are scoped by asset kind; paths pair with assets by manifest array order. */
export function createAssetResolver(project: PortableProject) {
  assertValid(checkProject(project));
  const byPath = new Map<string, {kind: AssetKind; asset: PortableAsset; path: string}>();
  const byKind = new Map<AssetKind, Map<string, {kind: AssetKind; asset: PortableAsset; path: string}>>();
  for (const kind of assetKinds) {
    const ids = new Map<string, {kind: AssetKind; asset: PortableAsset; path: string}>();
    project.assets[kind].forEach((asset, i) => {
      const entry = {kind, asset, path: project.manifest.assets[kind][i]};
      ids.set(asset.id, entry); byPath.set(entry.path, entry);
    });
    byKind.set(kind, ids);
  }
  return {byId: (kind: AssetKind, id: string) => byKind.get(kind)?.get(id), byPath: (path: string) => byPath.get(path)};
}
