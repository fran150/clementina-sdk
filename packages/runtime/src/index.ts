// The Clementina runtime: ca65 routines that load and use the assets the SDK
// builds (docs/gamedev/builder.md). The build copies the sources next to
// the game, assembles them and archives them into runtime.lib. The constants
// here are the descriptor layout the generated assets.s follows; the runtime
// test holds them to asm/runtime.inc.
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Where the sources are. */
export const runtimeDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'asm');
/** The sources, one object each in runtime.lib. */
export const runtimeSources = [
  'zp.s', 'core.s', 'load.s', 'items.s', 'relocate.s', 'palette.s', 'tileset.s', 'overlay.s',
  'bg_draw.s', 'bg_load.s', 'sprite_load.s', 'sprite_draw.s', 'animation.s', 'audio.s', 'song.s', 'sound.s', 'video.s',
] as const;
/** runtime.inc is the game's; rt_internal.inc the sources'. */
export const runtimeIncludes = ['runtime.inc', 'rt_internal.inc'] as const;

/** Descriptor byte 0. */
export const RUNTIME_ASSET_TYPE = {paletteConfig: 1, tileset: 2, background: 3, overlay: 4, sprites: 5, song: 6, sound: 7} as const;
/** Descriptor field offsets. */
export const RUNTIME_DESCRIPTOR = {
  TYPE: 0, LOC: 1, DEFAULT: 4, SIZE: 7, PATH: 10,
  BPP1: 12,
  WIDTH: 12, HEIGHT: 14, WIN_COL: 16, WIN_ROW: 18, WIN_COLS: 20, WIN_ROWS: 22,
  HOLES: 12, HOLE_TABLE: 13,
  SHAPES: 12, ANIMS: 13, ITEMS: 14, LOCS: 16,
  VOICES: 12,
  ENTRIES: 12,
} as const;
/** A location that means "not loaded". */
export const RUNTIME_NOT_LOADED = 0xffffff;
/** Bytes in an animation instance. */
export const RUNTIME_ANIM_SIZE = 12;
/** Bytes RuntimeSave keeps: the runtime's zero page. */
export const RUNTIME_STATE_SIZE = 42;
export const RUNTIME_ERRORS = {notLoaded: 1, location: 2, file: 3, range: 4, missing: 5, argument: 6} as const;

/** A location in a CPU bank: $80 | bank in the high byte, then the address in the $8000-$BFFF window. */
export function bankLocation(bank: number, address: number): number {
  if (!Number.isInteger(bank) || bank < 0 || bank > 31) throw new RangeError('bank must be 0..31');
  if (!Number.isInteger(address) || address < 0x8000 || address > 0xbfff) throw new RangeError('address must be in $8000-$BFFF');
  return ((0x80 | bank) << 16) | address;
}
