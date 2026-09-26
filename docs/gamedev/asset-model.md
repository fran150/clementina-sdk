# Game asset model

Phase 2 promotes the existing Clementina Studio model into portable SDK assets.

## Palette

A palette has exactly 8 RGB565 colors. A palette-bank config has exactly 16 entries,
each naming a palette or `null`. The same palette may occupy multiple banks.

## Tileset

A tileset is one CHR bank:

- 6,144 CHR bytes
- 256 tile indexes
- 16×16 authoring grid
- whole-tileset mode of 1bpp or 3bpp

`authoring.tilePaletteBanks` preserves the palette bank each tile was drawn against.
It is not CHR runtime data, but it is portable because another editor/agent needs it.
Compositions are also portable authoring metadata.

## Shape

A shape is an ordered list of up to 64 hardware sprites around an origin. Every
sprite carries tile, signed X/Y offset, palette bank, and flips. One shape uses one
tileset because all sprites share the current sprite CHR bank.

Shape names are assembly identifiers (1-32 characters). Shape ids are stable references
used by animation frames.

## Animation

An animation contains 1-255 frames. Each frame references a shape, lasts 1-255 ticks
at 60 Hz, may mirror the whole shape with `flipX`/`flipY`, and may offset it by
`dx`/`dy`. A flip mirrors about the shape's origin: every sprite's flip bit toggles
and its offset `x` becomes `-x - 8` (`y` likewise), since a hardware sprite is 8×8.
The offset applies after the flip. Absent flips are `false`.

All shapes referenced by one animation must use the same tileset, matching Studio's
current validation and the hardware's single sprite CHR-bank constraint.
