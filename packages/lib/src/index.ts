/**
 * Paths, embedded sources, and descriptor constants for the Clementina library, the SDK's ca65
 * routines for Clementina programs.
 * The build package writes these sources into a game and archives them as
 * clementina.lib. The constants mirror the ABI in asm/clementina-lib.inc.
 */
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export {libraryFiles} from './sources.js';

/** Absolute path to the ca65 sources shipped with this package; `libraryFiles` embeds the same text. */
export const libraryDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'asm');
/** Ordered ca65 source names; each becomes one object in clementina.lib. */
export const librarySources = [
  'zp.s', 'core.s', 'mia-index.s', 'location.s', 'load.s', 'sd-load.s', 'items.s', 'relocate.s', 'palette.s', 'tileset.s', 'overlay.s',
  'bg_draw.s', 'bg_load.s', 'sprite_load.s', 'sprite_draw.s', 'animation.s', 'audio.s', 'song.s', 'sound.s', 'video.s',
  'clock.s', 'input.s',
] as const;
/** Machine definitions generated from specs/: KERN_*, VIA and zero-page bounds, plus MIA's registers, ids and RAM layout. */
export const systemIncludes = ['clementina.inc', 'mia.inc'] as const;
/** Public game macros, the private ca65 definitions, and the machine definitions they use, copied by the builder. */
export const libraryIncludes = ['clementina-lib.inc', 'cl_internal.inc', ...systemIncludes] as const;

/** Asset type values stored at descriptor byte zero. */
export const LIBRARY_ASSET_TYPE = {paletteConfig: 1, tileset: 2, background: 3, overlay: 4, sprites: 5, song: 6, sound: 7} as const;
/** Byte offsets within asset descriptors; fields after PATH depend on asset type. */
export const LIBRARY_DESCRIPTOR = {
  TYPE: 0, LOC: 1, DEFAULT: 4, SIZE: 7, PATH: 10,
  BPP1: 12,
  WIDTH: 12, HEIGHT: 14, WIN_COL: 16, WIN_ROW: 18, WIN_COLS: 20, WIN_ROWS: 22,
  HOLES: 12, HOLE_TABLE: 13,
  SHAPES: 12, ANIMS: 13, ITEMS: 14, LOCS: 16,
  VOICES: 12,
  ENTRIES: 12,
} as const;
/** Three-byte location sentinel meaning the asset is not loaded. */
export const LIBRARY_NOT_LOADED = 0xffffff;
/** Bytes a game must allocate for one animation instance. */
export const LIBRARY_ANIM_SIZE = 12;
/** Zero-page bytes saved and restored by the LibSave/LibRestore macros. */
export const LIBRARY_STATE_SIZE = 42;
/** Error codes written to cl_error when a ca65 routine returns with carry set. */
export const LIBRARY_ERRORS = {notLoaded: 1, location: 2, file: 3, range: 4, missing: 5, argument: 6} as const;

/**
 * Encode a CPU bank location for an asset descriptor or macro argument.
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
