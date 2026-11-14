# The Clementina library

The current hardware contract lives in the [architecture docs](../architecture/overview.md)
and [specs](../../specs/).

The Clementina library is the SDK's library of 6502 routines for Clementina
programs. It gives a program higher-level operations than driving the hardware
by hand, so the program's own code can stay about the program. Its first
sections cover loading files from the SD card, palettes, tilesets, backgrounds,
overlays, sprites and animation, songs and sound effects, video control, frame
timing, and gamepad and keyboard input. The SDK adds sections as Clementina
programs need them.

The library provides primitives and never orchestrates. It has no scenes, no
level loader and no update loop of its own: the program decides when anything
is loaded, drawn, played or ticked, and where it goes.

## Using it

Every build with `build.assembly` links `clementina.lib`. `ld65` takes only the
modules a program calls, so a program that calls nothing gets no extra bytes.
To call the library, include its macros and clear BSS first:

```asm
.setcpu "65C02"
.include "clementina-lib.inc"   ; assets.inc includes it too

main:
  WaitTick                      ; wait for MIA's next 60 Hz tick
  ReadPad #0                    ; A = the CL_PAD_* bits player 0 holds
  ; ...
  jmp main
```

The program's linker configuration must place the `ZEROPAGE`, `CODE`,
`RODATA`, `DATA` and `BSS` segments; the assembly starter's `link.cfg` does.
The routines that work on assets take the descriptors that the
[asset builder](builder.md) generates in `assets.s`, and their macros in
`assets.inc` name assets by label.

## Packaging

- The SDK package is `@clementina/lib`. Related primitives share modules
  across 22 ca65 sources. The archive is assembled with `ca65 -D CL_CHECKS=…`
  and written with `ar65 r`. `ld65` includes referenced modules and their helpers.
  `lib/code-sizes.json` and the memory report (with `build.assets`) record CODE bytes per module;
  these are module sizes, not isolated per-routine costs.
- Every build with `build.assembly` assembles the sources, archives them into
  `clementina.lib` with `ar65`, and copies them into `<outputDirectory>/lib/` so
  they can be read and stepped through. That folder is on the include path.
- `ld65` links only the routines the game references, plus what those call.
- The `build.assembly.checks` option (default on) makes routines validate locations and
  item numbers and report errors. Turning it off removes the checks.

## Conventions

- **Arguments.** Small values go in A, X and Y. The rest go in a zero-page
  argument block, which the macros in `clementina-lib.inc` fill. The library's argument
  block and scratch bytes form one `ZEROPAGE` segment (42 bytes).
- **Initialization.** BLOAD does not clear BSS. The game must zero its BSS
  before the first library call; `examples/library-demo/src/main.s` shows this.
  Link at `$1800` or higher to preserve the resident loader. Keep zero page
  below `$E0`: `$E0–$FF` belongs to the system, and the kernel IRQ updates
  `$F7–$F8`.
- **Results.** Carry is clear on success. On failure carry is set and the
  reason is in `cl_error`.
- **MIA resources.** Routines use both index windows, `CFG_SELECT` and the
  command registers, and leave them changed. They use a block of index
  descriptors `$40` (window A, reads/source) and `$41` (window B, writes/destination).
- **Commands.** Before sending a command, each routine waits for the previous
  MIA command and for any running copy to finish. MIA drops a command when its
  queue is full (`ERROR_DEFER_CMD_QUEUE_FULL`, `clementina-mia` `sys/mia.c`).
- **Loads.** Every load has a blocking form and a start/poll pair
  (`LoadStart`, `LoadBusy`), so a game can stream while it plays. Only one SD
  job runs at a time.

## Interrupts

- **Default: main loop only.** The recommended pattern is a timer interrupt that
  only counts ticks, and a main loop that calls `TickAnimation` once per counted
  tick.
- **Without an interrupt.** `WaitTick` paces the main loop instead: it waits for
  MIA's 60 Hz count to move on, at any PHI2 speed, and returns the ticks since it
  last returned. It keeps that tick in BSS, so call it from one place.
- **Calling from a handler.** An interrupt handler may also
  call drawing, animation, sound and copy routines, provided it:
  1. writes PUSH to `MIA_CTX` on entry and POP before `RTI`;
  2. calls `LibSave` before its first library call and `LibRestore`
     after its last. These push and pull all 42 library zero-page bytes.
- **Loads are never interrupt-safe.** MIA runs one SD job at a time, and the
  job's control block lives in MIA RAM.
- **Shared state is the game's to guard.** That applies when both the main loop
  and a handler change the same animation or sound voice.

`SetLayers`, `SetChrBanks`, `SetScroll` and `SetViewport` configure video.
`SetCell` uses `cl_a6` for the tile and `cl_a7` for its attribute.
`LoadStart` is asynchronous for MIA; bank loads finish before it returns.
`LoadWait` reports completion and updates the descriptor. `LoadPart` is a raw
byte transfer and does not reinterpret the asset descriptor; use `LoadRect`,
`LoadRows`, `LoadColumns`, `LoadShape` or `LoadAnimation` for typed partial loads.

Studio previews animations and sounds at 60 ticks a second. A game that ticks at
60 Hz matches the previews.

## Functions

Each routine takes the asset's descriptor, and an optional location overrides
the default slot.

| Type | Routines |
| --- | --- |
| Every asset | `Load asset[, location]`; `LoadStart`/`LoadBusy`/`LoadWait`; `LoadPart asset, offset, length, location`; `Relocate asset, location`; `Forget asset` |
| Global | `HideSprites first, count` (sets the disable bit); `SetSpriteCount n` (the last OAM index the renderer scans); `LibSave`/`LibRestore` |
| Palette config | `UsePalettes config`; `UsePaletteBank config, bank[, target]` |
| Tileset | `UseTileset tileset, chrBank`: copies the tileset in unless it's already there, and sets that bank's 1bpp flag |
| Background | `DrawScreen bg, col, row, table` (40×25 cells); `DrawRect`; `DrawColumn`/`DrawRow` (for scrolling); `GetCell`/`SetCell`; `LoadRect`; `LoadRows bg, row, count[, location]` and `LoadColumns bg, col, count[, location]` |
| Overlay | `ShowOverlay overlay`; `FillPlaceholder overlay, placeholder, tiles`: writes tile numbers row by row and leaves attributes alone |
| Sprite file | `LoadSprites file[, location]`; `LoadShape`/`LoadAnimation file, item[, location]`; `LoadAnimationShapes file, anim` (loads whichever of its shapes aren't loaded); `ForgetShape`; `DrawShape file, shape, sprite, x, y, flips` |
| Animation | `StartAnimation inst, file, anim, sprite, x, y`; `TickAnimation inst`; `MoveAnimation inst, x, y`; `StopAnimation inst` |
| Song | `PlaySong song` (sets each voice's track address, then loads and starts the voices); `StopSong song`; `SongPosition voice` |
| Sound | `PlaySound sound, voice` (takes the voice with `AUDIO_VOICE_TAKE`); `TickSound voice` (after the last frame it releases the gate and gives the voice back with `AUDIO_VOICE_RELEASE`); `StopSound voice` |
| Timing | `WaitTick` (A = the ticks since the last `WaitTick`, 1–255; the first returns at once) |
| Input | `ReadPad player` (A = the `CL_PAD_*` bits held on gamepad 0–3; a disconnected gamepad reads as 0); `KeyHeld usage` (A = nonzero while that Keyboard/Keypad usage is held) |

Details:
- **Draw routines** read from an asset at its current location, with the map
  width as the row stride. They can also read from an explicit location and row
  stride, so a band loaded with `LoadRows` or `LoadColumns` works too. From MIA
  they copy by DMA; from a bank, the CPU copies.
- **Partial sprite loads.** Without a location, an item loads where it would sit
  if the whole file were at its slot, so separate partial loads never overlap.
- **Missing shapes.** `DrawShape` and `TickAnimation` look shapes up in the
  location table. With checks on, a missing shape is skipped and reported in
  `cl_error`, never drawn from the wrong memory.
- **`DrawShape`** returns the next free sprite, and raises the sprite count when
  the shape reaches past it, so the renderer scans those records.
- **Animation instances** use the `CL_ANIM_*` field constants and are blocks of
  `CL_ANIM_SIZE` (12) bytes that the game
  allocates. The library keeps one sound state per voice.
- **`ReadPad` bits.** `CL_PAD_UP`, `CL_PAD_DOWN`, `CL_PAD_LEFT` and `CL_PAD_RIGHT`
  ($01–$08) come from the d-pad or the left stick's digital directions;
  `CL_PAD_A` ($10) and `CL_PAD_B` ($20) from buttons 0 and 1; `CL_PAD_SELECT`
  ($40) and `CL_PAD_START` ($80) from buttons 10 and 11. The other buttons, the
  right stick and the analog values are left out.
- **The keyboard as player 0** is the library's choice, not the hardware's: the
  arrows and WASD steer, Z and Space are A, X is B, Tab is Select and Enter is
  Start. A game that wants other keys reads them with `KeyHeld`, which takes a
  HID Keyboard/Keypad usage ID (`$04`–`$1D` A–Z, `$28` Enter, `$2C` Space,
  `$4F`–`$52` the arrows).
