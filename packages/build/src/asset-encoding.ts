// Encodes one included asset. Naming, slot checks, and report generation belong
// to the planner; this module only selects source assets and encodes their bytes.
import {
  encodeBackgroundFile, encodeOverlayFile, encodePaletteConfig, encodeSongFile, encodeSoundFile, encodeSpriteFile, encodeTileset,
} from '@clementina/assets';
import {diagnostic, errorMessage, result, type ValidationResult} from '@clementina/core';
import type {PortableProject, ProjectAssetInclude} from '@clementina/project';
import type {PlannedAsset} from './assets.js';
import {identifier} from './asset-names.js';

type EncodedAsset = Omit<PlannedAsset, 'label' | 'file' | 'path' | 'slot'>;

/**
 * Encode one include from a validated project without assigning a card filename.
 *
 * @param project - Project containing the referenced portable assets.
 * @param entry - Validated include entry whose ID resolves in the project.
 * @param path - Manifest location used in diagnostics.
 * @returns Encoded bytes and metadata, or an asset-specific diagnostic.
 */
export function encodeIncludedAsset(project: PortableProject, entry: ProjectAssetInclude, path: string): ValidationResult<EncodedAsset> {
  const {assets} = project;
  const base = {kind: entry.kind, id: entry.id};
  try {
    switch (entry.kind) {
      case 'paletteConfig': {
        const asset = assets.paletteConfigs.find(item => item.id === entry.id)!;
        return result({...base, name: asset.name, bytes: encodePaletteConfig(asset, assets.palettes)}, []);
      }
      case 'tileset': {
        const asset = assets.tilesets.find(item => item.id === entry.id)!;
        return result({...base, name: asset.name, bytes: encodeTileset(asset), bpp: asset.bpp}, []);
      }
      case 'background': {
        const asset = assets.backgrounds.find(item => item.id === entry.id)!;
        return result({...base, name: asset.name, bytes: encodeBackgroundFile(asset), width: asset.width, height: asset.height}, []);
      }
      case 'overlay': {
        const asset = assets.overlays.find(item => item.id === entry.id)!;
        if (asset.placeholders.length > 255) return result(undefined, [diagnostic('build.assets.overlay.placeholders', path, `${asset.name} has more than 255 placeholders`)]);
        return result({...base, name: asset.name, bytes: encodeOverlayFile(asset),
          placeholders: asset.placeholders.map((placeholder, number) => ({id: placeholder.id, name: placeholder.name, label: '', number,
            col: placeholder.col, row: placeholder.row, width: placeholder.width, height: placeholder.height}))}, []);
      }
      case 'sprites': {
        const tileset = assets.tilesets.find(item => item.id === entry.id)!;
        const shapes = assets.shapes.filter(shape => shape.tilesetId === tileset.id);
        const shapeIds = new Set(shapes.map(shape => shape.id));
        const animations = assets.animations.filter(animation => animation.frames.length > 0 && shapeIds.has(animation.frames[0].shapeId));
        if (shapes.length + animations.length > 255) return result(undefined, [diagnostic('build.assets.sprites.items', path,
          `${tileset.name}'s sprite file has ${shapes.length + animations.length} shapes and animations; at most 255 fit`)]);
        const file = encodeSpriteFile(shapes, animations);
        return result({...base, name: tileset.name, bytes: file.bytes, items: [
          ...file.shapes.map((shape, number) => ({kind: 'shape' as const, id: shape.id, name: shape.name, label: `SHAPE_${identifier(shape.name)}`, number, offset: shape.offset, size: shape.size})),
          ...file.animations.map((animation, number) => ({kind: 'animation' as const, id: animation.id, name: animation.name, label: `ANIM_${identifier(animation.name)}`, number, offset: animation.offset, size: animation.size})),
        ]}, []);
      }
      case 'song': {
        const asset = assets.songs.find(item => item.id === entry.id)!;
        const file = encodeSongFile(asset, assets.instruments);
        if (file.bytes.length === 0) return result(undefined, [diagnostic('build.assets.song.empty', path, `${asset.name} has no notes, so there is nothing to play`)]);
        return result({...base, name: asset.name, bytes: file.bytes, voiceOffsets: file.voiceOffsets}, []);
      }
      case 'sound': {
        const asset = assets.sounds.find(item => item.id === entry.id)!;
        const file = encodeSoundFile(asset);
        return result({...base, name: asset.name, bytes: file.bytes, entries: file.entries}, []);
      }
    }
  } catch (error) {
    return result(undefined, [diagnostic('build.assets.encode', path, errorMessage(error))]);
  }
}
