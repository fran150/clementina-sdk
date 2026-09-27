# Asset builder and runtime

The current hardware contract lives in the [architecture docs](../architecture/overview.md),
[compatibility notes](../compatibility.md), and [specs](../../specs/).

## Purpose

Clementina Studio's Builder tab turns a project's assets into files that a
Clementina program loads from the SD card. It also supplies a library of 6502
routines that load and use those files.

| Who | Responsibility |
| --- | --- |
| Studio (Builder tab) | Edits the build settings: which assets are included, the memory slots, and each asset's default slot. Runs the SDK build and the emulator. |
| SDK (`@clementina/build` and `@clementina/runtime`) | Encodes asset files, generates descriptors and constants, builds the runtime library, checks the layout, and assembles a bootable folder. |
| The game's programmer | Decides when anything is loaded, drawn, played or ticked, and where it goes. |

The runtime provides primitives and never orchestrates. It has no scenes, no
level loader and no update loop of its own.

A game is a ca65 assembly program that the BASIC boot program starts. Once the
game runs, it owns the machine. It may overwrite BASIC's memory, the console
font in CHR banks 0–1 and the overlay. The runtime talks to MIA directly and
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
| `$13000–$13BFF` | 3 KiB | SD/FS control block and buffers | reserved; the runtime loads through it |
| `$14000–$3FFFF` | 176 KiB | free | user slots |

Sources: `clementina-mia` `video/video_dirty.h`, `input/input.h`,
`audio/audio.h`, `sd/sd.h`.

- `$14000–$17FFF` is free. `AUDIO_RESET` does not clear it.
- The firmware assigns nothing to `$00040–$000FF`, `$10D50–$10FFF`,
  `$11080–$11FFF`, `$12050–$12FFF` or `$13C00–$13FFF`. The Builder shows these
  gaps but doesn't offer them as slots until the firmware documents them as free.

### CPU memory

- **Runtime placement.** The runtime's code, descriptors, tables and zero-page
  bytes are ordinary ca65 segments. The game's linker configuration places them;
  the Builder doesn't.
- **Banks as storage.** Banks 1–31 (the `$8000–$BFFF` window, selected by VIA
  port A bits 0–4) can hold slots. Each bank is 16 KiB, so a slot never crosses
  a bank. An asset larger than 16 KiB can span consecutive whole banks, and the
  routines switch banks as they read.
- **Bank 0.** It holds BASIC's heap while BASIC runs. After a game takes over,
  the game's linker configuration decides what goes there.

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
- **Errors:** a slot overlapping a reserved range or another slot; an asset
  larger than its slot.
- **Warnings:** an asset whose default slot can't be used directly, such as a
  song in a CPU bank. The sequencer only reads MIA RAM, so that song must be
  copied into MIA before `PlaySong`.

### Moving data

| Path | Rate | CPU during the transfer |
| --- | --- | --- |
| MIA → MIA (`COPY_INDEXES`, DMA) | microseconds for kilobytes | free |
| SD → MIA (`FS_LOAD_TO_MIA_RAM`) | at most 1.5 MB/s, the 12 MHz SPI clock; expect a few hundred KB/s after FAT and MIA's 1 ms service slices. To be measured on hardware. | free; each command has a start-up delay and variable duration |
| SD → CPU bank | limited by the CPU copy below | busy |
| CPU bank ↔ MIA (through an index window) | 9–13 cycles per byte: about 90–130 KB/s at the default 1.2 MHz PHI2, and 0.6–0.85 MB/s at 8 MHz | busy, but starts at once and always takes the same time |

MIA can't write CPU RAM, so every byte of an SD → bank load passes through the
CPU. The current runtime reads at most 1,984 bytes at a time through FS handle 15
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

  Its macros fill the runtime's argument block and call a routine, for example
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

## Runtime library

### Packaging

- The SDK package is `@clementina/runtime`. Related primitives share modules
  across 17 ca65 sources. The archive is assembled with `ca65 -D RT_CHECKS=…`
  and written with `ar65 r`. `ld65` includes referenced modules and their helpers.
  `runtime/code-sizes.json` and the memory report record CODE bytes per module;
  these are module sizes, not isolated per-routine costs.
- The build assembles the sources with the project's defines, archives them into
  `runtime.lib` with `ar65`, and copies them into the build folder so they can
  be read and stepped through.
- `ld65` links only the routines the game references, plus what those call.
- The `checks` build option (default on) makes routines validate locations and
  item numbers and report errors. Turning it off removes the checks.

### Conventions

- **Arguments.** Small values go in A, X and Y. The rest go in a zero-page
  argument block, which the `assets.inc` macros fill. The runtime's argument
  block and scratch bytes form one `ZEROPAGE` segment (42 bytes).
- **Initialization.** BLOAD does not clear BSS. The game must zero its BSS
  before the first runtime call; `examples/runtime-demo/src/main.s` shows this.
  Link at `$1800` or higher to preserve the resident loader. Keep zero page
  below `$F0` while using the kernel IRQ, which updates `$F7–$F8`.
- **Results.** Carry is clear on success. On failure carry is set and the
  reason is in `rt_error`.
- **MIA resources.** Routines use both index windows, `CFG_SELECT` and the
  command registers, and leave them changed. They use a block of index
  descriptors `$40` (window A, reads/source) and `$41` (window B, writes/destination).
- **Commands.** Before sending a command, each routine waits for the previous
  MIA command and for any running copy to finish. MIA drops a command when its
  queue is full (`ERROR_DEFER_CMD_QUEUE_FULL`, `clementina-mia` `sys/mia.c`).
- **Loads.** Every load has a blocking form and a start/poll pair
  (`LoadStart`, `LoadBusy`), so a game can stream while it plays. Only one SD
  job runs at a time.

### Interrupts

- **Default: main loop only.** The recommended pattern is a timer interrupt that
  only counts ticks, and a main loop that calls `TickAnimation` once per counted
  tick.
- **Calling from a handler.** An interrupt handler may also
  call drawing, animation, sound and copy routines, provided it:
  1. writes PUSH to `MIA_CTX` on entry and POP before `RTI`;
  2. calls `RuntimeSave` before its first runtime call and `RuntimeRestore`
     after its last. These push and pull all 42 runtime zero-page bytes.
- **Loads are never interrupt-safe.** MIA runs one SD job at a time, and the
  job's control block lives in MIA RAM.
- **Shared state is the game's to guard.** That applies when both the main loop
  and a handler change the same animation or sound voice.

`SetLayers`, `SetChrBanks`, `SetScroll` and `SetViewport` configure video.
`SetCell` uses `rt_a6` for the tile and `rt_a7` for its attribute.
`LoadStart` is asynchronous for MIA; bank loads finish before it returns.
`LoadWait` reports completion and updates the descriptor. `LoadPart` is a raw
byte transfer and does not reinterpret the asset descriptor; use `LoadRect`,
`LoadRows`, `LoadColumns`, `LoadShape` or `LoadAnimation` for typed partial loads.

Studio previews animations and sounds at 60 ticks a second. A game that ticks at
60 Hz matches the previews.

### Functions

Each routine takes the asset's descriptor, and an optional location overrides
the default slot.

| Type | Routines |
| --- | --- |
| Every asset | `Load asset[, location]`; `LoadStart`/`LoadBusy`/`LoadWait`; `LoadPart asset, offset, length, location`; `Relocate asset, location`; `Forget asset` |
| Global | `HideSprites first, count` (sets the disable bit); `SetSpriteCount n` (the last OAM index the renderer scans); `RuntimeSave`/`RuntimeRestore` |
| Palette config | `UsePalettes config`; `UsePaletteBank config, bank[, target]` |
| Tileset | `UseTileset tileset, chrBank`: copies the tileset in unless it's already there, and sets that bank's 1bpp flag |
| Background | `DrawScreen bg, col, row, table` (40×25 cells); `DrawRect`; `DrawColumn`/`DrawRow` (for scrolling); `GetCell`/`SetCell`; `LoadRect`; `LoadRows bg, row, count[, location]` and `LoadColumns bg, col, count[, location]` |
| Overlay | `ShowOverlay overlay`; `FillPlaceholder overlay, placeholder, tiles`: writes tile numbers row by row and leaves attributes alone |
| Sprite file | `LoadSprites file[, location]`; `LoadShape`/`LoadAnimation file, item[, location]`; `LoadAnimationShapes file, anim` (loads whichever of its shapes aren't loaded); `ForgetShape`; `DrawShape file, shape, sprite, x, y, flips` |
| Animation | `StartAnimation inst, file, anim, sprite, x, y`; `TickAnimation inst`; `MoveAnimation inst, x, y`; `StopAnimation inst` |
| Song | `PlaySong song` (sets each voice's track address, then loads and starts the voices); `StopSong song`; `SongPosition voice` |
| Sound | `PlaySound sound, voice` (takes the voice with `AUDIO_VOICE_TAKE`); `TickSound voice` (after the last frame it releases the gate and gives the voice back with `AUDIO_VOICE_RELEASE`); `StopSound voice` |

Details:
- **Draw routines** read from an asset at its current location, with the map
  width as the row stride. They can also read from an explicit location and row
  stride, so a band loaded with `LoadRows` or `LoadColumns` works too. From MIA
  they copy by DMA; from a bank, the CPU copies.
- **Partial sprite loads.** Without a location, an item loads where it would sit
  if the whole file were at its slot, so separate partial loads never overlap.
- **Missing shapes.** `DrawShape` and `TickAnimation` look shapes up in the
  location table. With checks on, a missing shape is skipped and reported in
  `rt_error`, never drawn from the wrong memory.
- **`DrawShape`** returns the next free sprite, and raises the sprite count when
  the shape reaches past it, so the renderer scans those records.
- **Animation instances** use the `RT_ANIM_*` field constants and are blocks of
  `RT_ANIM_SIZE` (12) bytes that the game
  allocates. The runtime keeps one sound state per voice.

## Limits and verification

- Long file names: supported by the bundled TinyUSB FatFs configuration
  (`FF_USE_LFN 1`). Relative paths use the current directory (`FF_FS_RPATH 2`);
  the runtime leaves it alone, so start the program in its card folder.
- Slot alternatives use the largest asset size in the report, not their sum.
  Oversized backgrounds warn because typed partial loads can use a smaller
  window slot; other oversized assets are errors.
- Runtime bank loads are synchronous; pipelining is not implemented. Runtime
  checks catch supported location/item/range errors; the game owns allocation,
  non-overlapping copy destinations and the lifetime of slots and instances.

The checked-in [runtime demo](../../examples/runtime-demo/) exercises every public
primitive in the emulator. After building the SDK and the Go automation and
renderer executables, run:

```sh
node scripts/test-runtime-integration.mjs /path/to/clementina-automation /path/to/clementina-render
```

The script checks runtime memory and OAM state, bank crossings, large transfers,
overlay placeholders, and a rendered 320×200 image. See
[compatibility notes](../compatibility.md) for the physical-hardware verification
limit.
