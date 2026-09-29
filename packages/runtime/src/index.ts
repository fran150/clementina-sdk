/**
 * Paths, embedded sources, and descriptor constants for the ca65 asset runtime.
 * The build package writes these sources into a game and archives them as
 * runtime.lib. The constants mirror the ABI in asm/runtime.inc.
 */
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export {runtimeFiles} from './sources.js';

/** Absolute path to the ca65 sources shipped with this package; `runtimeFiles` embeds the same text. */
export const runtimeDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'asm');
/** Ordered ca65 source names; each becomes one object in runtime.lib. */
export const runtimeSources = [
  'zp.s', 'core.s', 'mia-index.s', 'location.s', 'load.s', 'sd-load.s', 'items.s', 'relocate.s', 'palette.s', 'tileset.s', 'overlay.s',
  'bg_draw.s', 'bg_load.s', 'sprite_load.s', 'sprite_draw.s', 'animation.s', 'audio.s', 'song.s', 'sound.s', 'video.s',
] as const;
/** Public game macros and the private ca65 definitions copied by the builder. */
export const runtimeIncludes = ['runtime.inc', 'rt_internal.inc'] as const;

/** Asset type values stored at descriptor byte zero. */
export const RUNTIME_ASSET_TYPE = {paletteConfig: 1, tileset: 2, background: 3, overlay: 4, sprites: 5, song: 6, sound: 7} as const;
/** Byte offsets within asset descriptors; fields after PATH depend on asset type. */
export const RUNTIME_DESCRIPTOR = {
  TYPE: 0, LOC: 1, DEFAULT: 4, SIZE: 7, PATH: 10,
  BPP1: 12,
  WIDTH: 12, HEIGHT: 14, WIN_COL: 16, WIN_ROW: 18, WIN_COLS: 20, WIN_ROWS: 22,
  HOLES: 12, HOLE_TABLE: 13,
  SHAPES: 12, ANIMS: 13, ITEMS: 14, LOCS: 16,
  VOICES: 12,
  ENTRIES: 12,
} as const;
/** Three-byte location sentinel meaning the asset is not loaded. */
export const RUNTIME_NOT_LOADED = 0xffffff;
/** Bytes a game must allocate for one animation instance. */
export const RUNTIME_ANIM_SIZE = 12;
/** Zero-page bytes saved and restored by the RuntimeSave/RuntimeRestore macros. */
export const RUNTIME_STATE_SIZE = 42;
/** Error codes written to rt_error when a ca65 routine returns with carry set. */
export const RUNTIME_ERRORS = {notLoaded: 1, location: 2, file: 3, range: 4, missing: 5, argument: 6} as const;

/**
 * Encode a CPU bank location for a runtime asset descriptor or macro argument.
 *
 * @param bank - Bank number, from 0 through 31.
 * @param address - CPU address within the $8000-$BFFF bank window.
 * @returns A 24-bit location with $80 | bank in its high byte.
 * @throws {RangeError} If either argument is not an integer in its valid range.
 */
export function bankLocation(bank: number, address: number): number {
  if (!Number.isInteger(bank) || bank < 0 || bank > 31) throw new RangeError('bank must be 0..31');
  if (!Number.isInteger(address) || address < 0x8000 || address > 0xbfff) throw new RangeError('address must be in $8000-$BFFF');
  return ((0x80 | bank) << 16) | address;
}
