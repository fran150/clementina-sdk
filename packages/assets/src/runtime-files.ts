// The files the asset builder writes for the SD card, one per asset (one per
// tileset for sprites), in the layouts docs/gamedev/builder.md defines. No file
// carries a header: dimensions, counts and item offsets go into the generated
// descriptor instead.
import {cellAttr, spriteAttr} from './attributes.js';
import {compileSong, soundWrites, type InstrumentData, type SongData, type SoundData} from './audio.js';
import type {AnimationAsset, BackgroundAsset, OverlayAsset, ShapeAsset} from './types.js';

export const OVERLAY_FILE_BYTES = 2000;
export const SHAPE_SPRITE_RECORD_BYTES = 6;
export const ANIMATION_FRAME_RECORD_BYTES = 7;

/** 1,000 tile bytes then 1,000 attribute bytes: the overlay table's own layout. */
export function encodeOverlayFile(overlay: Pick<OverlayAsset, 'cells'>): Uint8Array {
  const out = new Uint8Array(OVERLAY_FILE_BYTES);
  overlay.cells.forEach((cell, i) => { out[i] = cell.tile; out[1000 + i] = cellAttr(cell); });
  return out;
}

/** width x height tile bytes row by row, then the same number of attribute bytes. */
export function encodeBackgroundFile(background: Pick<BackgroundAsset, 'width' | 'height' | 'cells'>): Uint8Array {
  const cells = background.width * background.height, out = new Uint8Array(cells * 2);
  background.cells.forEach((cell, i) => { out[i] = cell.tile; out[cells + i] = cellAttr(cell); });
  return out;
}

export interface SpriteFileItem {id: string; name: string; offset: number; size: number}
export interface SpriteFile {bytes: Uint8Array; shapes: SpriteFileItem[]; animations: SpriteFileItem[]}

const push16 = (out: number[], n: number) => out.push(n & 255, (n >> 8) & 255);

/**
 * One tileset's shapes, then its animations. A shape is a sprite count and six
 * bytes per sprite: tile, signed 16-bit X and Y offsets, and the attribute byte
 * in the sprite layout. An animation is a frame count and seven bytes per frame:
 * the shape's number in this file, ticks, signed 16-bit dx and dy, and flags
 * (flip X in bit 0, flip Y in bit 1). Animations name shapes by number, so
 * every shape an animation uses must be in the file.
 */
export function encodeSpriteFile(shapes: readonly ShapeAsset[], animations: readonly AnimationAsset[]): SpriteFile {
  const number = new Map(shapes.map((shape, i) => [shape.id, i]));
  const out: number[] = [], shapeItems: SpriteFileItem[] = [], animationItems: SpriteFileItem[] = [];
  for (const shape of shapes) {
    const offset = out.length;
    out.push(shape.sprites.length);
    for (const sprite of shape.sprites) {
      out.push(sprite.tile);
      push16(out, sprite.x);
      push16(out, sprite.y);
      out.push(spriteAttr(sprite));
    }
    shapeItems.push({id: shape.id, name: shape.name, offset, size: out.length - offset});
  }
  for (const animation of animations) {
    const offset = out.length;
    out.push(animation.frames.length);
    for (const frame of animation.frames) {
      const shape = number.get(frame.shapeId);
      if (shape === undefined) throw new Error(`Animation ${animation.name} uses a shape that is not in this sprite file: ${frame.shapeId}`);
      out.push(shape, frame.ticks);
      push16(out, frame.dx ?? 0);
      push16(out, frame.dy ?? 0);
      out.push((frame.flipX ? 1 : 0) | (frame.flipY ? 2 : 0));
    }
    animationItems.push({id: animation.id, name: animation.name, offset, size: out.length - offset});
  }
  return {bytes: Uint8Array.from(out), shapes: shapeItems, animations: animationItems};
}

export interface SongFile {bytes: Uint8Array; voiceOffsets: Array<number | null>}

/** Each voice's compiled track, back to back; a voice without notes has no track. */
export function encodeSongFile(song: SongData, instruments: readonly InstrumentData[]): SongFile {
  const compiled = compileSong(song, instruments), out: number[] = [];
  const voiceOffsets = compiled.voices.map(voice => {
    if (!voice) return null;
    const offset = out.length;
    // Runtime descriptors use a 16-bit offset; $FFFF means no voice.
    if (offset >= 0xffff) throw new RangeError(`Song voice offset ${offset} exceeds the runtime descriptor limit of 65534 bytes`);
    out.push(...voice.bytes);
    return offset;
  });
  return {bytes: Uint8Array.from(out), voiceOffsets};
}

export interface SoundFile {bytes: Uint8Array; entries: number}

/**
 * The frames' register writes: per frame a count byte, then that many
 * (voice register, value) pairs. The last entry releases the gate, so a sound
 * has one entry more than it has frames.
 */
export function encodeSoundFile(sound: SoundData): SoundFile {
  const writes = soundWrites(sound), out: number[] = [];
  for (const frame of writes) {
    out.push(frame.length);
    for (const [register, value] of frame) out.push(register, value);
  }
  return {bytes: Uint8Array.from(out), entries: writes.length};
}
