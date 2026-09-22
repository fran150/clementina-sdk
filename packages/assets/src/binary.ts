import {assertValid, diagnostic, result} from '@clementina/core';
import type {PaletteAsset, PaletteConfigAsset, TilesetAsset} from './types.js';
import {checkAsset} from './validate.js';

export const MIA_PALETTE_ADDRESS = 0x00100;
export const MIA_CHR_ADDRESS = 0x00200;
export const PALETTE_BANK_BYTES = 16;
export const PALETTE_MEMORY_BYTES = 256;
export const CHR_BANK_BYTES = 6144;
export const CHR_BANKS = 8;

/** Encode one eight-color palette as the MIA RGB565 little-endian bank format. */
export function encodePalette(asset: PaletteAsset): Uint8Array {
  const palette = assertValid(checkAsset(asset, 'palettes')) as PaletteAsset;
  const output = new Uint8Array(PALETTE_BANK_BYTES);
  palette.colors.forEach((color, index) => {
    output[index * 2] = color & 0xff;
    output[index * 2 + 1] = color >>> 8;
  });
  return output;
}

/** Resolve a portable palette configuration into the complete 256-byte MIA palette region. */
export function encodePaletteConfig(configValue: PaletteConfigAsset, paletteValues: readonly PaletteAsset[]): Uint8Array {
  const config = assertValid(checkAsset(configValue, 'paletteConfigs')) as PaletteConfigAsset;
  const palettes = new Map<string, PaletteAsset>();
  for (const value of paletteValues) {
    const palette = assertValid(checkAsset(value, 'palettes')) as PaletteAsset;
    if (palettes.has(palette.id)) assertValid(result(undefined, [diagnostic('asset.duplicate.id', '', `Duplicate palette ${palette.id}`)]));
    palettes.set(palette.id, palette);
  }
  const output = new Uint8Array(PALETTE_MEMORY_BYTES);
  config.banks.forEach((id, bank) => {
    if (id === null) return;
    const palette = palettes.get(id);
    if (!palette) assertValid(result(undefined, [diagnostic('asset.reference', `/banks/${bank}`, `Unknown palette ${id}`)]));
    output.set(encodePalette(palette!), bank * PALETTE_BANK_BYTES);
  });
  return output;
}

/** Emit one already-planar portable tileset exactly as one 6 KiB MIA CHR bank. */
export function encodeTileset(asset: TilesetAsset): Uint8Array {
  const tileset = assertValid(checkAsset(asset, 'tilesets')) as TilesetAsset;
  return Uint8Array.from(tileset.chr);
}

/** Return the verified MIA address for a CHR bank without assigning a bank implicitly. */
export function chrBankAddress(bank: number): number {
  if (!Number.isInteger(bank) || bank < 0 || bank >= CHR_BANKS) throw new RangeError(`CHR bank must be an integer from 0 through ${CHR_BANKS - 1}`);
  return MIA_CHR_ADDRESS + bank * CHR_BANK_BYTES;
}
