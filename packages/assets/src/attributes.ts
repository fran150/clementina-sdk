import type {BackgroundCell, ShapeSprite} from './types.js';

/** Encode the palette, priority, and flip bits of a hardware sprite. */
export function spriteAttr(sprite: Pick<ShapeSprite, 'paletteBank' | 'flipX' | 'flipY'> & {priority?: boolean}): number {
  return (sprite.paletteBank & 15)
    | (sprite.priority ? 16 : 0)
    | (sprite.flipX ? 32 : 0)
    | (sprite.flipY ? 64 : 0);
}

/** Encode a sprite's signed X/Y high bits and optional disable flag. */
export function spriteExt(sprite: Pick<ShapeSprite, 'x' | 'y'> & {disabled?: boolean}): number {
  return ((sprite.x >> 8) & 3)
    | (((sprite.y >> 8) & 1) << 2)
    | (sprite.disabled ? 8 : 0);
}

/** Encode a background or overlay cell's attribute byte. */
export function cellAttr(cell: Pick<BackgroundCell, 'paletteBank' | 'flipX' | 'flipY'> & {priority?: boolean; chrAlt?: boolean}): number {
  return (cell.paletteBank & 15)
    | (cell.flipX ? 16 : 0)
    | (cell.flipY ? 32 : 0)
    | (cell.priority ? 64 : 0)
    | (cell.chrAlt ? 128 : 0);
}
