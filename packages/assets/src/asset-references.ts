import {diagnostic, type ClementinaDiagnostic} from '@clementina/core';
import type {AnimationAsset, PortableAssetSet, ShapeAsset} from './types.js';

/** Check references between structurally valid assets in a set. */
export function assetReferenceDiagnostics(set: PortableAssetSet): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  const palettes = new Set(set.palettes.map(asset => asset.id));
  const tilesets = new Set(set.tilesets.map(asset => asset.id));
  const shapes = new Map(set.shapes.map(asset => [asset.id, asset]));
  const instruments = new Set(set.instruments.map(asset => asset.id));

  set.paletteConfigs.forEach((asset, index) => asset.banks.forEach((id, bank) => {
    if (id !== null && !palettes.has(id)) diagnostics.push(diagnostic('asset.reference', `/paletteConfigs/${index}/banks/${bank}`, `Unknown palette ${id}`));
  }));
  set.shapes.forEach((asset, index) => {
    if (!tilesets.has(asset.tilesetId)) diagnostics.push(diagnostic('asset.reference', `/shapes/${index}/tilesetId`, `Unknown tileset ${asset.tilesetId}`));
  });
  for (const kind of ['backgrounds', 'overlays'] as const) {
    set[kind].forEach((asset, index) => {
      diagnostics.push(...tilesetReferenceDiagnostics(asset, tilesets).map(item => ({...item, path: `/${kind}/${index}${item.path}`})));
    });
  }
  set.animations.forEach((asset, index) => {
    diagnostics.push(...animationReferenceDiagnostics(asset, shapes).map(item => ({...item, path: `/animations/${index}${item.path}`})));
  });
  set.songs.forEach((asset, index) => asset.voices.forEach((voice, voiceIndex) => voice.notes.forEach((note, noteIndex) => {
    if (!instruments.has(note.instrumentId)) diagnostics.push(diagnostic('asset.reference', `/songs/${index}/voices/${voiceIndex}/notes/${noteIndex}/instrumentId`, `Unknown instrument ${note.instrumentId}`));
  })));
  return diagnostics;
}

/** Check the primary and alternate tilesets of a map or overlay. */
export function tilesetReferenceDiagnostics(asset: {tilesetId: string; altTilesetId: string}, ids: ReadonlySet<string>): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  if (!ids.has(asset.tilesetId)) diagnostics.push(diagnostic('asset.reference', '/tilesetId', `Unknown tileset ${asset.tilesetId}`));
  if (!ids.has(asset.altTilesetId)) diagnostics.push(diagnostic('asset.reference', '/altTilesetId', `Unknown tileset ${asset.altTilesetId}`));
  return diagnostics;
}

/** Check that an animation's shapes exist and share one tileset. */
export function animationReferenceDiagnostics(asset: AnimationAsset, shapes: ReadonlyMap<string, ShapeAsset>): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [], tilesets = new Set<string>();
  asset.frames.forEach((frame, index) => {
    const shape = shapes.get(frame.shapeId);
    if (!shape) diagnostics.push(diagnostic('asset.reference', `/frames/${index}/shapeId`, `Unknown shape ${frame.shapeId}`));
    else tilesets.add(shape.tilesetId);
  });
  if (tilesets.size > 1) diagnostics.push(diagnostic('animation.tileset', '/frames', `Every shape in ${asset.name} must use the same tileset`));
  return diagnostics;
}
