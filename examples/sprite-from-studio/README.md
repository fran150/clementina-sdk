# Sprite from Studio

A BASIC program that moves a ship drawn in Clementina Studio with the arrow
keys.

- `assets/tilesets/ship.tileset.json` is the ship: four tiles, 0 and 1 on
  top and 16 and 17 below, saved in Studio as the composition `Ship`.
- `assets/palettes/ship.palette.json` holds its colors, and the palette
  config puts it in palette bank 1. Bank 0 keeps the main palette for text.
- `build.video` in `clementina.yaml` has the bootstrap load the palette
  config and put the tileset in CHR bank 2 before the program runs.
- `src/main.cbas` points the sprites at bank 2 with `SPRBANK 2` and draws
  the ship as four sprites with palette bank 1. It moves the ship one pixel
  for every 10 ms since its last pass, so the ship moves 100 pixels a second
  however long a pass takes.

The program reads held keys, so run it in the video client window. From this
folder:

```sh
clementina build
clementina-emulator --sd build/sd
```

Then type `RUN "BOOT.BAS"` in the video client. To change the ship or its
colors, open `clementina.yaml` in Studio with File ▸ Open Project…, save,
and build again.
