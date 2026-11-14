# Asset builder

The current hardware contract lives in the [architecture docs](../architecture/overview.md)
and [specs](../../specs/).

## Purpose

Clementina Studio's Builder tab turns a project's assets into files that a
Clementina program loads from the SD card. The program loads and uses them with
the [Clementina library](library.md), which every assembly build links.

| Who | Responsibility |
| --- | --- |
| Studio (Builder tab) | Edits the build settings: which assets are included, the memory slots, and each asset's default slot. Runs the SDK build and the emulator. |
| SDK (`@clementina/build` and `@clementina/lib`) | Encodes asset files, generates descriptors and constants, builds the Clementina library, checks the layout, and assembles a bootable folder. |
| The game's programmer | Decides when anything is loaded, drawn, played or ticked, and where it goes. |

A game is a ca65 assembly program that the BASIC boot program starts. Once the
game runs, it owns the machine. It may overwrite BASIC's memory, the console
font in CHR banks 0–1 and the overlay. The library talks to MIA directly and
needs neither the kernel nor BASIC.

## Memory

### MIA RAM

| Range | Size | Hardware use | In the Builder |
| --- | ---: | --- | --- |
| `$00000–$0003F` | 64 B | video local and render control | reserved |
| `$00100–$001FF` | 256 B | palette RAM: 16 banks × 8 RGB565 colors | built-in slot `palettes` |
| `$00200–$0C1FF` | 48 KiB | CHR banks 0–7, 6,144 B each | built-in slots `chr0`–`chr7` |
| `$0C200–$1007F` | 16,000 B | background nametables 0–7, then attributes 0–7 | written by routines, never a load target |
| `$10080–$1084F` | 2,000 B | overlay nametable, then attributes | built-in slot `overlay` |
| `$10850–$10D4F` | 1,280 B | OAM: 256 records × 5 B | written by routines |
| `$11000–$1107F` | 128 B | input state and clock snapshot | reserved |
| `$12000–$1204F` | 80 B | audio registers | reserved |
| `$13000–$13BFF` | 3 KiB | SD/FS control block and buffers | reserved; the library loads through it |
| `$14000–$3FFFF` | 176 KiB | free | user slots |

Sources: `clementina-mia` `video/video_dirty.h`, `input/input.h`,
`audio/audio.h`, `sd/sd.h`.

- `$14000–$3FFFF` is the programs' block of MIA RAM. The firmware writes it
  only where a program points it, and no reset clears it.
- Everything below `$14000` belongs to the firmware, including the unassigned
  gaps `$00040–$000FF`, `$10D50–$10FFF`, `$11080–$11FFF`, `$12050–$12FFF` and
  `$13C00–$13FFF`, which it keeps for future state. The Builder shows the gaps
  but never offers them as slots.

### CPU memory

- **Library placement.** The library's code, descriptors, tables and zero-page
  bytes are ordinary ca65 segments. The game's linker configuration places them;
  the Builder doesn't.
- **Banks as storage.** Banks 1–31 (the `$8000–$BFFF` window, selected by VIA
  port A bits 0–4) can hold slots. Each bank is 16 KiB. A slot may span
  consecutive banks through bank 31; the routines switch banks as they read.
- **Bank 0.** It holds BASIC's heap while BASIC runs. After a game takes over,
  the game's linker configuration decides what goes there. A BASIC program can
  free its top with `build.basic.memoryTop`.

### Slots

A slot is a named range, either in MIA RAM or in CPU banks.

- **Defaults.** Every included asset names a default slot. A load puts the asset
  at its slot's address unless the call gives another location.
- **Alternatives.** Several assets may share one slot, such as level 1's map and
  level 2's map. They are alternatives the game loads at different times. The
  Builder never decides which one is loaded when.
- **Built-in slots.** `palettes`, `chr0`–`chr7` and `overlay` are the hardware
  places a file can load straight into.

Build checks:
- **Errors:** a slot overlapping a reserved range; an asset larger than its
  slot, except a background that can use partial loads.
- **Warnings:** a slot overlapping another slot or the program (see the
  [memory layout](../project-format.md#memory-layout)); an asset whose default slot can't be used directly, such as a
  song in a CPU bank. The sequencer only reads MIA RAM, so that song must be
  copied into MIA before `PlaySong`. An oversized background also warns because
  typed partial loads can use the slot.

### Moving data

| Path | Rate | CPU during the transfer |
| --- | --- | --- |
| MIA → MIA (`COPY_INDEXES`, DMA) | microseconds for kilobytes | free |
| SD → MIA (`FS_LOAD_TO_MIA_RAM`) | at most 1.5 MB/s, the 12 MHz SPI clock; expect a few hundred KB/s after FAT and MIA's 1 ms service slices. To be measured on hardware. | free; each command has a start-up delay and variable duration |
| SD → CPU bank | limited by the CPU copy below | busy |
| CPU bank ↔ MIA (through an index window) | a hand-written loop: 9.4–14 cycles per byte, about 85–130 KB/s at the default 1.2 MHz PHI2 and 0.57–0.85 MB/s at 8 MHz; the library's own copies: about 26 cycles per byte, 46 KB/s at 1.2 MHz (see [performance](performance.md)) | busy, but starts at once and always takes the same time |

MIA can't write CPU RAM, so every byte of an SD → bank load passes through the
CPU. The current library reads at most 1,984 bytes at a time through FS handle 15
and the SD transfer buffer, then copies each chunk into the bank. It handles
bank boundaries and strided rows. Overlapping SD reads with CPU copies remains
a future optimization; current bank loads block.

Where each kind of data fits best (a recommendation):
- **MIA RAM:** anything touched every frame. Copies from it are nearly free.
- **CPU banks:**
  - data that doesn't fit in MIA, such as a 400 KB map scrolled straight from banks;
  - data that is scattered rather than contiguous, such as a scroll column,
    which is 25 bytes spread down a table;
  - work that must take the same time every frame.
- **SD:** everything else, loaded between levels or streamed ahead of need.

## Files

The build writes one file per asset, except that all the shapes and animations
of one tileset share a single sprite file.

- **Names.** File names are ASCII and come from the asset names, defaulting to
  8.3 form. Overrides may use long names: the bundled TinyUSB FatFs has
  `FF_USE_LFN 1`. Paths are relative to the current SD directory
  (`FF_FS_RPATH 2`, `FS_CHDIR`).
- **No headers.** Dimensions, counts and item offsets go into the generated
  descriptor, not the file.
- **Hardware layouts load directly.** A file that matches a hardware layout can
  load straight into it.

| Asset | Contents | Size | Usable from |
| --- | --- | ---: | --- |
| Palette config | 16 banks × 8 colors, RGB565 little-endian, in palette RAM order | 256 B | anywhere; `UsePalettes` copies it |
| Tileset | the CHR bank exactly as MIA stores it | 6,144 B | anywhere; `UseTileset` copies it |
| Overlay | 1,000 tile bytes, then 1,000 attribute bytes | 2,000 B | anywhere; `ShowOverlay` copies it |
| Background | width × height tile bytes row by row, then the same number of attribute bytes | 2 × w × h | anywhere; draw routines copy from it |
| Sprite file (one per tileset) | the tileset's shapes, then its animations | varies | anywhere; the CPU reads it |
| Song | each voice's track exactly as Studio's song compiler emits it, back to back | varies | MIA RAM only (the sequencer reads it) |
| Sound | its frames | varies | anywhere; the CPU reads it |

Background and overlay attribute bytes use the hardware layout: palette bank in
bits 0–3, flip X in bit 4, flip Y in bit 5, priority in bit 6 and alternate CHR
in bit 7. Keeping tiles and attributes in two separate halves lets each half
copy into its own table with the same geometry. In a row-major map, a band of
rows is one contiguous run per half, and a band of columns is one piece per row.

Sprite file records (multi-byte values are little-endian):
- **Shape:** a sprite count (1 byte), then 6 bytes per sprite:
  - tile;
  - X offset, signed 16-bit;
  - Y offset, signed 16-bit;
  - attribute byte in the sprite layout: palette in bits 0–3, priority in bit 4,
    flip X in bit 5, flip Y in bit 6.
- **Animation:** a frame count (1 byte), then 7 bytes per frame:
  - shape number (the shape's index in this file);
  - ticks, 1–255;
  - dx, signed 16-bit;
  - dy, signed 16-bit;
  - flags: flip X in bit 0, flip Y in bit 1.
  A frame's flip mirrors the whole shape about its origin, as
  [asset-model.md](asset-model.md) defines.

Sound frames: each frame is a count byte followed by that many (voice register,
value) pairs. They are exactly what Studio's `soundWrites` computes: the whole
voice record on the first frame, then only what changes, and a final entry that
releases the gate.

## Generated sources

- **`assets.inc`** holds constants and macros:
  - slot names, addresses and sizes;
  - each asset's size and dimensions;
  - shape and animation numbers, with their offsets and sizes inside their
    sprite file;
  - overlay placeholder rectangles (column, row, width, height).

  Its macros fill the library's argument block and call a routine, for example
  `DrawShape HERO_SPRITES, HERO_IDLE, 0, px, py`.
- **`assets.s`** holds one descriptor per included asset and one location table
  per sprite file, in a data segment the game's linker configuration places.

A descriptor holds:
- the asset's current location;
- its default location;
- its size and file path;
- type-specific fields: a tileset's 1bpp flag, a background's width and height,
  each song voice's track offset, and each sprite-file item's offset and size.

A **location** is 3 bytes:
- `$000000–$03FFFF` is a MIA address;
- a top byte of `$80 | bank` means a CPU bank, with the CPU address in the low
  16 bits;
- `$FFFFFF` means not loaded.

Every location starts as not loaded, and every load updates it. A sprite file's
location table has one entry per shape and per animation. That lets a game load
single items wherever it likes, while animations keep referring to shared shapes
by number.

## The Clementina library

Every assembly build links the [Clementina library](library.md), which has the
routines that load and use these files: `Load`, `DrawScreen`, `PlaySong` and the
rest. `assets.inc` includes it, so a game that includes `assets.inc` can call
them directly.

## Limits and verification

- Long file names: supported by the bundled TinyUSB FatFs configuration
  (`FF_USE_LFN 1`). Relative paths use the current directory (`FF_FS_RPATH 2`);
  the library leaves it alone, so start the program in its card folder.
- Slot alternatives use the largest asset size in the report, not their sum.
  Oversized backgrounds warn because typed partial loads can use a smaller
  window slot; other oversized assets are errors.
- A song whose later voice begins at offset `$FFFF` or beyond cannot fit the
  library's 16-bit voice descriptor and fails the build with a diagnostic.
- Library bank loads are synchronous; pipelining is not implemented. Library
  checks catch supported location/item/range errors; the game owns allocation,
  non-overlapping copy destinations and the lifetime of slots and instances.

The checked-in [library demo](../../examples/library-demo/) exercises every public
primitive in the emulator. After building the SDK and the Go automation and
renderer executables, run:

```sh
node scripts/test-library-integration.mjs /path/to/clementina-automation /path/to/clementina-render
```

The script checks library memory and OAM state, bank crossings, large transfers,
overlay placeholders, and a rendered 320×200 image.
