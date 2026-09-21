import {assertValid, diagnostic, result, schemaDiagnostics, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import type {AnimationAsset, PaletteAsset, PaletteConfigAsset, PortableAssetSet, ShapeAsset, TilesetAsset} from './types.js';

export type PortableAsset = PaletteAsset | PaletteConfigAsset | TilesetAsset | ShapeAsset | AnimationAsset;
export const assetKinds = ['palettes', 'paletteConfigs', 'tilesets', 'shapes', 'animations'] as const;
export type AssetKind = typeof assetKinds[number];
export const assetSchemas = {palettes: 'palette', paletteConfigs: 'palette-config', tilesets: 'tileset', shapes: 'shape', animations: 'animation'} as const;

/** Validate untrusted JSON without coercion, mutation, or throwing. */
export function checkAsset(value: unknown, kind?: AssetKind): ValidationResult<PortableAsset> {
  const format = value && typeof value === 'object' ? (value as {format?: unknown}).format : undefined;
  const selected = kind ?? assetKinds.find(k => `clementina-${assetSchemas[k]}` === format);
  if (!selected) return result(value, [diagnostic('asset.format', '/format', 'Unknown asset format')]);
  const diagnostics = schemaDiagnostics(assetSchemas[selected], value);
  if (diagnostics.length) return result(value, diagnostics);
  const a = value as PortableAsset;
  if (!a.name.trim()) diagnostics.push(diagnostic('asset.name', '/name', 'Name must not be blank'));
  if (a.format === 'clementina-tileset') {
    const names = new Set<string>();
    a.authoring.compositions.forEach((c, i) => {
      const path = `/authoring/compositions/${i}`;
      if (!c.name.trim() || names.has(c.name)) diagnostics.push(diagnostic('asset.composition.name', `${path}/name`, 'Composition names must be unique and non-empty'));
      names.add(c.name);
      if (c.x + c.width > 16 || c.y + c.height > 16) diagnostics.push(diagnostic('asset.composition.bounds', path, 'Composition lies outside the tileset'));
    });
  }
  return result(value, diagnostics);
}

export function checkAssetSet(value: unknown): ValidationResult<PortableAssetSet> {
  const diagnostics: ClementinaDiagnostic[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result(value, [diagnostic('asset.set', '', 'Expected an asset set')]);
  const set = value as PortableAssetSet;
  for (const kind of assetKinds) {
    if (!Array.isArray(set[kind])) { diagnostics.push(diagnostic('asset.collection', `/${kind}`, 'Expected an array')); continue; }
    if ((kind === 'shapes' || kind === 'animations') && set[kind].length > 255) diagnostics.push(diagnostic('asset.limit', `/${kind}`, 'At most 255 assets are supported'));
    const ids = new Set<string>(), names = new Set<string>();
    set[kind].forEach((asset, i) => {
      const r = checkAsset(asset, kind);
      diagnostics.push(...r.diagnostics.map(d => ({...d, path: `/${kind}/${i}${d.path}`})));
      if (!r.ok) return;
      if (ids.has(asset.id)) diagnostics.push(diagnostic('asset.duplicate.id', `/${kind}/${i}/id`, 'Asset ids must be unique within their kind'));
      if (names.has(asset.name.toLowerCase())) diagnostics.push(diagnostic('asset.duplicate.name', `/${kind}/${i}/name`, 'Asset names must be unique ignoring case'));
      ids.add(asset.id); names.add(asset.name.toLowerCase());
    });
  }
  // References are inspected only after structural validation has succeeded.
  if (diagnostics.length) return result(value, diagnostics);
  const palettes = new Set(set.palettes.map(a => a.id)), tilesets = new Set(set.tilesets.map(a => a.id));
  const shapes = new Map(set.shapes.map(a => [a.id, a]));
  set.paletteConfigs.forEach((a, i) => a.banks.forEach((id, j) => {
    if (id !== null && !palettes.has(id)) diagnostics.push(diagnostic('asset.reference', `/paletteConfigs/${i}/banks/${j}`, `Unknown palette ${id}`));
  }));
  set.shapes.forEach((a, i) => {
    if (!tilesets.has(a.tilesetId)) diagnostics.push(diagnostic('asset.reference', `/shapes/${i}/tilesetId`, `Unknown tileset ${a.tilesetId}`));
  });
  set.animations.forEach((a, i) => diagnostics.push(...animationReferences(a, shapes).map(d => ({...d, path: `/animations/${i}${d.path}`}))));
  return result(value, diagnostics);
}
function animationReferences(a: AnimationAsset, shapes: Map<string, ShapeAsset>): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [], tilesets = new Set<string>();
  a.frames.forEach((f, i) => {
    const shape = shapes.get(f.shapeId);
    if (!shape) diagnostics.push(diagnostic('asset.reference', `/frames/${i}/shapeId`, `Unknown shape ${f.shapeId}`));
    else tilesets.add(shape.tilesetId);
  });
  if (tilesets.size > 1) diagnostics.push(diagnostic('animation.tileset', '/frames', `Every shape in ${a.name} must use the same tileset`));
  return diagnostics;
}
export function validatePalette(a: unknown): void { assertValid(checkAsset(a, 'palettes')); }
export function validateTileset(a: unknown): void { assertValid(checkAsset(a, 'tilesets')); }
export function validatePaletteConfig(value: unknown, ids?: Set<string>): void {
  const a = assertValid(checkAsset(value, 'paletteConfigs')) as PaletteConfigAsset;
  if (ids) assertValid(result(a, a.banks.flatMap((id, i) => id !== null && !ids.has(id) ? [diagnostic('asset.reference', `/banks/${i}`, `Unknown palette ${id}`)] : [])));
}
export function validateShape(value: unknown, ids?: Set<string>): void {
  const a = assertValid(checkAsset(value, 'shapes')) as ShapeAsset;
  if (ids && !ids.has(a.tilesetId)) assertValid(result(a, [diagnostic('asset.reference', '/tilesetId', `Unknown tileset ${a.tilesetId}`)]));
}
export function validateAnimation(value: unknown, shapes?: Map<string, ShapeAsset>): void {
  const a = assertValid(checkAsset(value, 'animations')) as AnimationAsset;
  if (shapes) assertValid(result(a, animationReferences(a, shapes)));
}
export function validateAssetSet(value: unknown): void { assertValid(checkAssetSet(value)); }
