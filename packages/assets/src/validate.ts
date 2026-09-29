import {assertValid, diagnostic, result, schemaDiagnostics, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {assetReferenceDiagnostics, animationReferenceDiagnostics, tilesetReferenceDiagnostics} from './asset-references.js';
import {assetRuleDiagnostics} from './asset-rules.js';
import type {AnimationAsset, BackgroundAsset, InstrumentAsset, OverlayAsset, PaletteAsset, PaletteConfigAsset, PortableAssetSet, ShapeAsset, SongAsset, SoundAsset, TilesetAsset} from './types.js';

export type PortableAsset = PaletteAsset | PaletteConfigAsset | TilesetAsset | ShapeAsset | AnimationAsset | BackgroundAsset | OverlayAsset | InstrumentAsset | SoundAsset | SongAsset;
export const assetKinds = ['palettes', 'paletteConfigs', 'tilesets', 'backgrounds', 'overlays', 'shapes', 'animations', 'instruments', 'sounds', 'songs'] as const;
export type AssetKind = typeof assetKinds[number];
/** Kinds a manifest may leave out; a missing list means no assets of that kind. */
export const optionalAssetKinds: readonly AssetKind[] = ['instruments', 'sounds', 'songs'];
export const assetSchemas = {palettes: 'palette', paletteConfigs: 'palette-config', tilesets: 'tileset', backgrounds: 'background', overlays: 'overlay', shapes: 'shape', animations: 'animation', instruments: 'instrument', sounds: 'sound', songs: 'song'} as const;

/** Validate untrusted JSON without coercion, mutation, or throwing. */
export function checkAsset(value: unknown, kind?: AssetKind): ValidationResult<PortableAsset> {
  const format = value && typeof value === 'object' ? (value as {format?: unknown}).format : undefined;
  const selected = kind ?? assetKinds.find(candidate => `clementina-${assetSchemas[candidate]}` === format);
  if (!selected) return result(value, [diagnostic('asset.format', '/format', 'Unknown asset format')]);
  const diagnostics = schemaDiagnostics(assetSchemas[selected], value);
  if (diagnostics.length) return result(value, diagnostics);
  return result(value, assetRuleDiagnostics(value as PortableAsset));
}

/** Validate every asset, unique identity, and cross-asset reference in a set. */
export function checkAssetSet(value: unknown): ValidationResult<PortableAssetSet> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result(value, [diagnostic('asset.set', '', 'Expected an asset set')]);
  const set = value as PortableAssetSet;
  const diagnostics: ClementinaDiagnostic[] = [];
  for (const kind of assetKinds) {
    if (!Array.isArray(set[kind])) {
      diagnostics.push(diagnostic('asset.collection', `/${kind}`, 'Expected an array'));
      continue;
    }
    if (kind !== 'palettes' && kind !== 'paletteConfigs' && kind !== 'tilesets' && set[kind].length > 255) {
      diagnostics.push(diagnostic('asset.limit', `/${kind}`, 'At most 255 assets are supported'));
    }
    const ids = new Set<string>(), names = new Set<string>();
    set[kind].forEach((asset, index) => {
      const checked = checkAsset(asset, kind);
      diagnostics.push(...checked.diagnostics.map(item => ({...item, path: `/${kind}/${index}${item.path}`})));
      if (!checked.ok) return;
      if (ids.has(asset.id)) diagnostics.push(diagnostic('asset.duplicate.id', `/${kind}/${index}/id`, 'Asset ids must be unique within their kind'));
      if (names.has(asset.name.toLowerCase())) diagnostics.push(diagnostic('asset.duplicate.name', `/${kind}/${index}/name`, 'Asset names must be unique ignoring case'));
      ids.add(asset.id);
      names.add(asset.name.toLowerCase());
    });
  }
  // Reference checks assume each collection and asset is structurally valid.
  if (diagnostics.length) return result(value, diagnostics);
  return result(value, assetReferenceDiagnostics(set));
}

/** Throw if a value is not a portable palette. */
export function validatePalette(value: unknown): void { assertValid(checkAsset(value, 'palettes')); }

/** Throw if a value is not a portable tileset. */
export function validateTileset(value: unknown): void { assertValid(checkAsset(value, 'tilesets')); }

/** Validate a palette configuration and, when supplied, its palette references. */
export function validatePaletteConfig(value: unknown, ids?: Set<string>): void {
  const config = assertValid(checkAsset(value, 'paletteConfigs')) as PaletteConfigAsset;
  if (ids) assertValid(result(config, config.banks.flatMap((id, index) => id !== null && !ids.has(id) ? [diagnostic('asset.reference', `/banks/${index}`, `Unknown palette ${id}`)] : [])));
}

/** Validate a shape and, when supplied, its tileset reference. */
export function validateShape(value: unknown, ids?: Set<string>): void {
  const shape = assertValid(checkAsset(value, 'shapes')) as ShapeAsset;
  if (ids && !ids.has(shape.tilesetId)) assertValid(result(shape, [diagnostic('asset.reference', '/tilesetId', `Unknown tileset ${shape.tilesetId}`)]));
}

/** Validate a background and, when supplied, both tileset references. */
export function validateBackground(value: unknown, tilesetIds?: Set<string>): void {
  const background = assertValid(checkAsset(value, 'backgrounds')) as BackgroundAsset;
  if (tilesetIds) assertValid(result(background, tilesetReferenceDiagnostics(background, tilesetIds)));
}

/** Validate an overlay and, when supplied, both tileset references. */
export function validateOverlay(value: unknown, tilesetIds?: Set<string>): void {
  const overlay = assertValid(checkAsset(value, 'overlays')) as OverlayAsset;
  if (tilesetIds) assertValid(result(overlay, tilesetReferenceDiagnostics(overlay, tilesetIds)));
}

/** Validate an animation and, when supplied, its shape references and tileset. */
export function validateAnimation(value: unknown, shapes?: Map<string, ShapeAsset>): void {
  const animation = assertValid(checkAsset(value, 'animations')) as AnimationAsset;
  if (shapes) assertValid(result(animation, animationReferenceDiagnostics(animation, shapes)));
}

/** Throw if an asset set or any of its references is invalid. */
export function validateAssetSet(value: unknown): void { assertValid(checkAssetSet(value)); }
