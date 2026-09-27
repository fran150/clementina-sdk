# Asset builder and runtime

**Status: implemented; runtime and Studio verification recorded below.** Agreed with the project owner on
2026-09-26. Each change under "Firmware, emulator and ROM changes" says whether
it has landed. Until a change lands, `docs/architecture/`,
`docs/compatibility.md` and `specs/` stay authoritative for that behavior.

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

- `$14000–$17FFF` is free since change 1 below. Earlier firmware zeroed it on
  every `AUDIO_RESET`.
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
- **Calling from a handler (needs change 6).** An interrupt handler may also
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
| Every asset | `Load asset[, location]`; `LoadStart`/`LoadBusy`/`LoadWait`; `LoadPart asset, offset, length, location` (needs change 2); `Relocate asset, location`; `Forget asset` |
| Global | `HideSprites first, count` (sets the disable bit); `SetSpriteCount n` (the last OAM index the renderer scans); `RuntimeSave`/`RuntimeRestore` |
| Palette config | `UsePalettes config`; `UsePaletteBank config, bank[, target]` |
| Tileset | `UseTileset tileset, chrBank`: copies the tileset in unless it's already there, and sets that bank's 1bpp flag |
| Background | `DrawScreen bg, col, row, table` (40×25 cells); `DrawRect`; `DrawColumn`/`DrawRow` (for scrolling); `GetCell`/`SetCell`; `LoadRect`; `LoadRows bg, row, count[, location]` and `LoadColumns bg, col, count[, location]` (needs changes 2 and 3) |
| Overlay | `ShowOverlay overlay`; `FillPlaceholder overlay, placeholder, tiles`: writes tile numbers row by row and leaves attributes alone |
| Sprite file | `LoadSprites file[, location]`; `LoadShape`/`LoadAnimation file, item[, location]`; `LoadAnimationShapes file, anim` (loads whichever of its shapes aren't loaded); `ForgetShape`; `DrawShape file, shape, sprite, x, y, flips` |
| Animation | `StartAnimation inst, file, anim, sprite, x, y`; `TickAnimation inst`; `MoveAnimation inst, x, y`; `StopAnimation inst` |
| Song | `PlaySong song` (sets each voice's track address, then loads and starts the voices); `StopSong song`; `SongPosition voice` |
| Sound | `PlaySound sound, voice` (takes the voice with `AUDIO_VOICE_TAKE`); `TickSound voice` (after the last frame it releases the gate and gives the voice back with `AUDIO_VOICE_RELEASE`); `StopSound voice` |

Details:
- **Draw routines** read from an asset at its current location, with the map
  width as the row stride. They can also read from an explicit location and row
  stride, so a band loaded with `LoadRows` or `LoadColumns` works too. From MIA
  they copy by DMA (change 4); from a bank, the CPU copies.
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

## Firmware, emulator and ROM changes

Each change lands in `clementina-mia` and is mirrored in `clementina-6502`. When
it lands, `specs/` and `docs/architecture/` here are updated. Command ids and
register addresses below are proposals for the firmware owner.

### 1. Remove the legacy default track area (landed)

Before this change, `mia_audio_reset_runtime_state` (`audio/audio.c`) did two
things at boot and on every `AUDIO_RESET`, which BASIC's `SNDCLR` issues:
- it zeroed `$14000–$17FFF`;
- it seeded each voice's track base to `$14000 + voice × $1000`.

The new behavior:
- A voice has no track until `AUDIO_SEQ_SET_BASE<v>` sets one. Boot and
  `AUDIO_RESET` forget every base; the firmware stores `0xFFFFFFFF`, which a
  24-bit `SET_BASE` can never produce.
- Starting a voice with no base leaves it stopped: no gate-off and no
  `IRQ_AUDIO_SEQ_DONE`.
- Nothing clears MIA RAM on audio reset.

BASIC is unaffected, because `TRACK` always sets its base. `$14000 + voice ×
$1000` remains BASIC's own default for `TRACK` without an address.

Touches:
- `clementina-mia`:
  - `audio.h`: remove the `MIA_SEQ_DEFAULT_*` macros;
  - `audio.c`: reset, `audio_seq_start_one` and the status print;
  - `con/con_cmds.c`: `audio seq test` must set an explicit base;
  - docs: `docs/audio-sequencer.md` and `docs/sd.md`.
- `clementina-6502`: `pkg/components/mia/audio_sequencer.go` and its three
  default-region tests.
- `clementina-studio`: `tests/firmware/audio-harness.c` sets bases explicitly,
  and `MiaEngine.start` skips voices with no track.
- This repository: `defaultTrackBase` in `specs/audio.json`,
  `docs/architecture/audio.md`, `docs/compatibility.md`,
  `docs/program-loading.md`, and the `audio-sequencer-sd-memory-overlap` entry
  in `specs/known-issues.json`.
- `clementina-rom`: comments and doc wording only.

### 2. Load part of a file into MIA RAM (landed)

A new command, `FS_LOAD_PART` (`$8A`), SD protocol 7:
- It loads `SD_TRANSFER_LEN` bytes, starting at file offset `SD_PART_OFFSET`
  (`$30–$33`), to `SD_DEST_ADDR`.
- It is a chunked job like `FS_LOAD_TO_MIA_RAM`, and uses its own file.
- Reaching end of file ends it early and still succeeds, with `SD_FILE_POS`
  holding the count loaded.
- `FS_LOAD_TO_MIA_RAM` is unchanged. Its own command means a caller that never
  heard of the new fields can't inherit values left there by another caller.

### 3. Strided loads (landed)

`FS_LOAD_PART` with `SD_PART_ROWS` (`$34–$35`) greater than 0:
- It loads that many rows of `SD_TRANSFER_LEN` bytes each.
- After each row, the file position advances by `SD_PART_FILE_STRIDE`
  (`$36–$39`) and the destination by `SD_PART_RAM_STRIDE` (`$3A–$3C`).
- A zero row length, or a rectangle past the top of MIA RAM, fails with
  `ERROR_FS_INVALID_REQUEST` before anything is written.
- Firmware in `sd/sd.c`, emulator in `sd.go`. Documented in `docs/sd.md`
  ("Protocol version 7") and `specs/storage.json`.

### 4. Rectangle copy inside MIA RAM (landed)

A new command, `COPY_RECT` (`$11`):
- **Parameters.** p1 is the source descriptor, p2 the destination descriptor,
  and p3 the row count (0 means 256).
- **Row length.** The source's limit minus its current address, as
  `COPY_INDEXES` does with a count of 0.
- **Strides.** After each row, the source address advances by the source
  descriptor's step, and the destination's by its own step. The descriptors
  themselves don't move.
- **Completion.** Every row is marked dirty, and `IRQ_COMMAND` is raised once,
  after the last row.
- **Fills.** A source step of 0 repeats the first row, which is how rectangle
  fills work.
- **Implementation.** It shares change 5's queue: a queued job is a rectangle,
  and `COPY_INDEXES` is a one-row rectangle. Firmware in `mem/dma.c` and
  `cmds/cmds.c`, emulator in `commands.go`.

### 5. A copy waits for the running copy (landed)

`command_copy_indexes` called `mia_dma_transfer_init` (`mem/dma.c`), which
reprogrammed the single DMA channel even while a copy was running. It also
replaced the dirty range queued for the video update. The kernel's `MCOPY`
avoided this by waiting after every copy.

The fix: a copy requested while another runs joins a queue of eight, and the
completion interrupt starts the next one. Every copy's range is marked dirty and
raises `IRQ_COMMAND` when it finishes. `MIA_STAT_DMA_RUNNING` stays set until the
queue drains, and a full queue reports `ERROR_DMA_QUEUE_FULL` (`$13`).
- It doesn't block, so the audio interrupt, which has a lower priority than
  command handling, keeps its timing.
- The emulator copies synchronously, so it only mirrors the new error code.
- `COPY_RECT` (change 4) uses the same queue.

### 6. Context stack for interrupt handlers (landed)

- **Register.** `MIA_CTX` at `$FFF5`, formerly reserved:
  - writing `$01` pushes and writing `$02` pops; other values do nothing;
  - four levels deep;
  - overflow queues `ERROR_CTX_OVERFLOW` (`$22`) and underflow
    `ERROR_CTX_UNDERFLOW` (`$23`);
  - reads return the last value written, not the depth. MIA commits a CPU
    write to the register block asynchronously, so a depth that core 1 wrote
    there could be overwritten by the CPU's own byte.
- **What a push saves.** `IDXA_SELECT`, `IDXB_SELECT`, `CFG_SELECT`,
  `CMD_PARAM1–3`, and the full records of the two descriptors bound to the
  windows, including their current addresses.
- **What a pop does.** It restores all of that, then reloads `IDXA_PORT`,
  `IDXB_PORT` and `CFG_PORT`, as select writes do.
- **Why a register.** It takes effect when the write lands, in core 1's
  register-write handler next to the select writes, not in the bus read path.
  It can't be a queued command: commands reach core 0 through a FIFO and run
  later, so a push would save whatever the handler had already changed.
- **Cost.** About 12 CPU cycles per interrupt. Saving just the six registers in
  software takes about 90 cycles, and software can't cheaply save descriptor
  positions.
- **Where it lives.** Firmware in `sys/mia.c`, emulator in `context.go`.
  Documented in the MIA README's "Context stack" section and in
  `specs/mia-registers.json`.

### 7. BASIC and the kernel (landed)

No new keywords, only optional trailing arguments:

| Statement | Uses |
| --- | --- |
| `MIALOAD "path", addr[, len[, offset[, rows, filestride, ramstride]]]` | change 2 when `offset` is given or `len` is over 65535; change 3 when `rows` is given |
| `MCOPY src, dst, len[, rows, srcstride, dststride]` | change 4 when `rows` is given |
| `MFILL addr, len, value[, rows, stride]` | fills the first row, then change 4 with a source stride of 0 |

- **Kernel services.** `mia_mem_rect` and `mia_mem_fill_rect` (`memory.s`) do
  the rectangle work:
  - they check the whole rectangle before writing anything;
  - they send `COPY_RECT` in batches of 256 rows;
  - row lengths and strides are limited to 65535 bytes.
- **Interrupts.** The kernel's interrupt handler brackets its cursor toggle with
  `MIA_CTX` push and pop. BASIC's `SEI` fences stay as a second guard.
- **Size.** The image grew by 786 bytes, so BASIC has 23,361 bytes free. The
  kernel region's soft ceiling rose from `$1000` to `$1200`.
- **Tests.** `clementina-rom` `tests/basic_memory_test.go` and
  `tests/basic_fs_test.go`, run by `tests/run_input.py`.

## SDK changes

- **Audio assets.** Portable instruments, sounds and songs, with the shared
  compiler in `@clementina/assets/audio` (also used by Studio).
- **Manifest.** A builder section in `clementina.yaml`, sketched below. Studio
  saves the Builder's settings here through the project APIs, so a CLI build
  produces the same output without Studio. `build.video` keeps working for
  projects that place graphics from the boot program.

  ```yaml
  build:
    outputDirectory: build
    assets:
      folder: ASSETS            # on the card, relative to the game's folder
      checks: true
      slots:
        - {name: LEVEL_MAP, mia: 0x18000, size: 0x10000}
        - {name: ACTORS, bank: 3, address: 0x8000, size: 0x4000}
      include:
        - {kind: paletteConfig, id: palette-config:main, slot: palettes}
        - {kind: tileset, id: tileset:hero, slot: chr2}
        - {kind: background, id: background:level1, slot: LEVEL_MAP}
        - {kind: background, id: background:level2, slot: LEVEL_MAP}   # an alternative to level1
        - {kind: sprites, id: tileset:hero, slot: ACTORS, file: HERO.SPR}
  ```

- **Build output:**

  ```text
  build/
    sd/                 copy to the card: the boot program, GAME.PRG, ASSETS/…
    runtime/            runtime sources and runtime.lib
    assets.inc
    assets.s
    memory-report.json  slots, sizes, errors and warnings
  ```

- **Boot program.** The one `@clementina/build` already generates, reduced to
  loading and running `GAME.PRG`, since the game loads its own assets. See
  [program-loading.md](../program-loading.md).

## Studio's Builder tab

It is built from the shared editor shell (`clementina-studio`
`docs/editor-shell.md`), like every other workspace:

- **Left dock:** assets grouped by type, each with its include toggle and
  default slot.
- **Main area:** the MIA RAM map and the CPU bank map. Slots are blocks, with
  their alternative assets stacked inside. Dragging an asset onto a slot makes
  it that asset's default.
- **Right dock:** the selection's properties.
  - A slot: name, place, address, size.
  - An asset: slot, size, file name, and a reference of the routines for its
    type, with their code sizes.
- **Rail and status:** tools (select, new slot), then the shared edit actions.
  Build and Run in Emulator call the SDK, and errors and warnings show in the
  status bar and the report.

## Implementation order

1. **Done:** firmware/emulator changes 1–6 and SDK specs.
2. **Done:** ROM BASIC forms (change 7).
3. **Done and tested:** portable audio, encoders, generated sources, manifest
   checks and memory report; CLI and debugger mount the build's `sdRoot`.
4. **Done and emulator-tested:** runtime loads, copies and every public primitive.
5. **Done:** Studio Builder, shared shell/history, main-process SDK IPC,
   portable-folder save/build, emulator launch and native renderer preview.
6. **Done:** `examples/runtime-demo`, plus
   `scripts/test-runtime-integration.mjs <automation> <renderer>`. The game
   records checkpoints and errors at `$0700`; the script checks memory, bank
   boundary crossings, an 80 KB relocation, placeholder 128, and a 320×200 PNG.

## Resolved details

- Index descriptors: `$40` and `$41`.
- Long file names: supported by the bundled TinyUSB FatFs configuration
  (`FF_USE_LFN 1`). Relative paths use the current directory (`FF_FS_RPATH 2`);
  the runtime leaves it alone, so start the program in its card folder.
- Package: `@clementina/runtime`.
- Slot alternatives use the largest asset size in the report, not their sum.
  Oversized backgrounds warn because typed partial loads can use a smaller
  window slot; other oversized assets are errors.
- Runtime bank loads are synchronous; pipelining is not implemented. Runtime
  checks catch supported location/item/range errors; the game owns allocation,
  non-overlapping copy destinations and the lifetime of slots and instances.
