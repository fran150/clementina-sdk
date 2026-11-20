# Portable Clementina project format

Portable project data is separate from Studio session state.

A `.cstudio` file remains Studio's editor/session container. The SDK formats below
are the shared contract that Studio, CLI tools, ChatGPT/Claude agents, CI, and future
editor integrations can all read and write.

## Project layout

```text
my-game/
├── clementina.yaml
├── src/
│   └── main.cbas
└── assets/
    ├── palettes/
    ├── palette-configs/
    ├── tilesets/
    ├── backgrounds/
    ├── overlays/
    ├── shapes/
    ├── animations/
    ├── instruments/
    ├── sounds/
    └── songs/
```

All manifest paths are project-relative POSIX-style paths. Absolute paths, `..`,
empty path components, and backslashes are rejected by the SDK validator.

## Manifest

```yaml
format: clementina-project
version: 1
name: Temple Explorer
target:
  machine: clementina-6502
  phi2Hz: 1200000
program:
  entry: src/main.cbas
assets:
  palettes:
    - assets/palettes/main.palette.json
  paletteConfigs:
    - assets/palette-configs/main.palette-config.json
  tilesets:
    - assets/tilesets/player.tileset.json
  backgrounds:
    - assets/backgrounds/level1.background.json
  overlays:
    - assets/overlays/hud.overlay.json
  shapes:
    - assets/shapes/player_idle.shape.json
  animations:
    - assets/animations/player_idle.animation.json
  instruments:
    - assets/instruments/lead.instrument.json
  sounds:
    - assets/sounds/jump.sound.json
  songs:
    - assets/songs/theme.song.json
```

`target.phi2Hz` is optional: the CPU clock in Hz the program runs at, from 1
to 8,000,000. The board starts at 1,200,000 (1.2 MHz); any other value makes
the generated loader set the speed before it loads anything (a `speed` step,
see `docs/program-loading.md`), and a real-time debug session starts the
emulator at it. The three audio
lists are optional, and a missing list means no assets of that kind; every other
list is required, even when it is empty.

## Program parts

A project is described by the parts it has, not by a kind:

- `program.entry` (optional) is a BASIC program. It runs last.
- `build.assembly` (optional) is ca65 code linked into one PRG, plus one PRG
  for each bank listed in `build.assembly.banks`.

A project needs at least one of them:

| Parts | What the loader does |
| --- | --- |
| BASIC only | Loads the assets, then `LOAD`s and `RUN`s the program. |
| Assembly only | A generated loader loads the assets and `BRUN`s the PRG, which takes over. |
| BASIC and assembly | Loads the assets, `BLOAD`s the PRG (it returns to BASIC), then `LOAD`s and `RUN`s the program, which calls the code with `SYS`. |

`program.entry` needs `build.basic` settings, and `build.basic` needs
`program.entry`. BASIC source is text and uses the `.cbas` extension; `.BAS` is
for tokenized programs, the files the machine's `SAVE` and `LOAD` use, so an
entry with another extension gets the `project.program.extension` warning. Asset builds (`build.assets`) need `build.assembly`, because the
Clementina library that loads them is ca65 code.

## Build declaration

The build is explicit and reproducible. All paths remain project-relative.
The linker configuration owns CPU memory placement; the SDK verifies its output
against `loadAddress` rather than choosing an address.

### Addresses

Addresses and sizes (`loadAddress`, `memoryTop`, and a slot's `mia`,
`address` and `size`) take a decimal number or hex written as `$7000` or
`0x7000`; the three below are the same address. Neither hex form needs quotes:
YAML reads `$7000` as text, which the SDK turns into a number, and `0x7000` as
a number already.

```yaml
loadAddress: $7000
loadAddress: 0x7000
loadAddress: 28672
```

Other spellings, such as `7000h` or a hex string without its prefix, are
rejected with `project.address`. An address out of its range is reported in
hex: `$C000 (49152) must be at most $BFFF (49151)`. Bank numbers and CHR banks
stay plain numbers. Assembly `defines` are passed to ca65 as written, so a
define such as `BASE: $7000` is ca65's own hex.

```yaml
build:
  outputDirectory: build
  assembly:
    sources:
      - src/main.s
      - src/player.s
    linkerConfig: config/game.cfg
    outputName: game
    loadAddress: $6000
    entrySymbol: game_start
    includeDirectories:
      - src/include
    defines:
      DEBUG: 1
    checks: true             # the Clementina library's argument checks
  video:
    paletteConfigId: palette-config:main
    tilesets:
      - tilesetId: tileset:player
        bank: 3
```

Images linked at `$8000-$BFFF` must also declare a CPU `bank` from 1 through 31.

### Code in several banks

`build.assembly` links one image at `loadAddress`. More code can go in the
banked window `$8000-$BFFF`, one bank at a time: `banks` lists each extended
RAM bank (1-31) and the ld65 MEMORY area that holds its code.

```yaml
build:
  assembly:
    sources: [src/common.s, src/bank1.s, src/bank2.s]
    linkerConfig: link.cfg
    outputName: code
    loadAddress: $7000
    entrySymbol: show_room
    banks:
      - bank: 1
        memory: BANK1
      - bank: 2
        memory: BANK2
```

In the linker configuration, each of those areas starts in `$8000-$BFFF`, has
an output file of its own and says its bank:

```
MEMORY {
  MAIN:  start = $7000, size = $1000, file = %O;
  BANK1: start = $8000, size = $4000, file = "%O.bank1", bank = 1;
  BANK2: start = $8000, size = $4000, file = "%O.bank2", bank = 2;
}
```

The build links once, so code in any bank can call or name a label in any
other, and ca65's `.bank(label)` gives the bank that `bank = n` sets. It
then packs each bank's file as its own PRG (`build/code.bank1.prg`, on the card
`CODE.BANK1.PRG`), and the loader puts each in its bank with
`BANK 1:BLOAD "CODE.BANK1.PRG"` before it loads the main image. The build
stops with an error when a listed area is missing, is written to the main
output (ld65 writes an area without `file` there), has another `bank`, or holds
bytes outside `$8000-$BFFF`; an area without `bank` gets a warning, because
`.bank()` of its labels then fails to link. A bank listed with no code yet is a
warning and loads nothing. A segment written to any other file is still an
error (`assembler.image.multiple-output`). Each bank number may hold one image,
so `banks` may not repeat a bank or the main image's `bank`.

Code running in `$8000-$BFFF` must not switch banks itself: the store to
`VIA_ORA` maps another bank under it, and the next instruction comes from
there. Switch from code below `$8000`, such as a far-call routine in the main
image; [`examples/multi-bank`](../examples/multi-bank) does. The assembly
language server warns about such stores ([asm-lsp](asm-lsp.md)), and the
debugger can stop on them ([debugger](debugger.md)).


Each tileset placement names a distinct CHR bank from 0 through 7. The build emits
the selected complete palette configuration at MIA `$00100` and each tileset at
its declared CHR bank. No placement is inferred from manifest array order.

A BASIC program's settings name its output file and, optionally, where BASIC's
memory ends:

```yaml
program:
  entry: src/main.cbas
build:
  outputDirectory: build
  basic:
    outputName: game
    memoryTop: $A000
```

`memoryTop` lowers `MEMSIZ` before the program loads (`POKE $3F,lo:POKE $40,hi:CLEAR`).
BASIC then keeps its program, variables and strings below it, so bank-0 RAM from
`memoryTop` to `$BFFF` is free for assembly the program calls with `SYS`. `FRE`
reports correspondingly less memory. The program text starts at the bottom of
BASIC's area, so lowering the top does not make room low in RAM: code at `$1800`
still overlaps the program. The value is from `$1600` (the kernel region's end;
BASIC's interpreter follows it, so the usable floor is higher and moves with each
ROM build) to `$C000` (the default).

## Memory layout

The manifest places every part: the PRG with `loadAddress` and `bank` (and each
bank's code with `banks` and the linker configuration), video data
with `build.video`, assets with `build.assets` slots, and BASIC's top with
`memoryTop`. The build never moves a part. It writes `memory-layout.json`, a map of
every part in CPU memory and MIA RAM next to the machine's own areas (system RAM,
the kernel, BASIC's workspace and the SD/FS state at MIA `$13000`), and warns
(`build.layout.overlap`) about each overlap. An overlap is a warning, not an error:
avoiding one, or overwriting BASIC on purpose, is the programmer's decision. An
assembly-only program takes over with `BRUN`, so overlapping BASIC is not reported
for it; overlapping the kernel, which holds the loader, is.

`@clementina/build` and `clementina build` produce the linked binary and PRG,
debug artifacts, `load-plan.json`, `memory-layout.json` and `boot.cbas` inside
`outputDirectory`, and the card folder `<outputDirectory>/sd` with `BOOT.BAS`,
the program and the palette/CHR files ([program loading](program-loading.md)). With `build.assets`, sprite files contain each tileset's
shapes followed by animations, with generated item/location tables.

## Asset build (`build.assets`)

For a project with assembly, add:

```yaml
build:
  outputDirectory: build
  assembly:
    sources: [src/main.s]
    linkerConfig: link.cfg
    outputName: game
    loadAddress: $1800      # retain the resident kernel loader
    entrySymbol: game_start
  assets:
    folder: ASSETS
    slots:
      - {name: maps, mia: $14000, size: $8000}
      - {name: actors, bank: 1, address: $8000, size: $4000}
    include:
      - {kind: paletteConfig, id: palette-config:main, slot: palettes}
      - {kind: tileset, id: tileset:player, slot: chr2}
      - {kind: sprites, id: tileset:player, slot: actors, file: PLAYER.SPR}
      - {kind: background, id: background:level1, slot: maps}
```

Kinds are `paletteConfig`, `tileset`, `background`, `overlay`, `sprites`, `song`
and `sound`. A sprite file uses its **tileset ID**. `file` overrides the generated
8.3 name; names are unique ignoring case. `folder` defaults to `ASSETS`. Built-in slots are `palettes`, `chr0`–`chr7` and
`overlay`; user MIA slots stay inside `$14000–$3FFFF`. CPU slots name a bank
1–31 and address `$8000–$BFFF`, and may span consecutive banks through bank 31.
Duplicate or unresolved includes, reserved locations and invalid assembly
constants are rejected. Overlapping slots are a warning
(`project.build.slot.overlap`). Assets sharing a slot are alternatives.

Output includes `assets.inc`, `assets.s` and `memory-report.json`, next to the
Clementina library's sources, listings, `lib/clementina.lib` and
`lib/code-sizes.json`, which every assembly build writes. The deployable card is
`build/sd`, containing `BOOT.BAS`, `GAME.PRG` and `ASSETS/`, plus the compiled
`<NAME>.BAS` when the project has a BASIC program, as for every build. Library calls own
loading and playback; merely including an asset does not load or use it.
See [the Builder](gamedev/builder.md), [the Clementina library](gamedev/library.md)
and `examples/library-demo`.

## Portable asset envelopes

Every asset is self-identifying and versioned:

| Asset | `format` | Version |
| --- | --- | ---: |
| palette | `clementina-palette` | 1 |
| palette config | `clementina-palette-config` | 1 |
| tileset | `clementina-tileset` | 1 |
| background | `clementina-background` | 1 |
| overlay | `clementina-overlay` | 1 |
| shape | `clementina-shape` | 1 |
| animation | `clementina-animation` | 1 |
| instrument | `clementina-instrument` | 1 |
| sound effect | `clementina-sound` | 1 |
| song | `clementina-song` | 1 |

JSON Schemas live in `specs/schema/`.

The audio assets are the ones Studio's Sounds and Music editors author. An
instrument is what the sequencer's `SET_*` opcodes put on a voice: waveform,
pulse width, envelope and volume. A song is four voices of notes on a step grid,
at a tempo, with an optional loop start; its notes name instruments by id, and
the notes on one voice must not overlap. Each note starts with its own attack,
except a `legato` one, which carries on the note sounding before it with a new
pitch and no new attack. A sound effect is one voice's register
values frame by frame (60 frames a second) under one envelope and pan.
`@clementina/assets` compiles them the way the hardware plays them:
`compileSong` produces the sequencer tracks and `soundWrites` the per-frame
register writes (see [Audio](architecture/audio.md)).

## Studio boundary

Portable assets keep authoring data another editor or agent needs:

- tileset palette-bank hints
- tileset compositions
- shape canvas/origin metadata

They intentionally omit Studio session-only state:

- `activeConfigId`
- `previewBackground`
- window state, selection, undo/redo, zoom, etc.

`@clementina/project` provides conversion helpers for Studio project version 2.

## Format boundary

Scene files (which combine backgrounds, shapes, and a bank config, and decide
sprite-versus-background priority) are not defined in portable format version 1.
See [BASIC tooling](basic-tooling.md) and [program loading](program-loading.md)
for BASIC-project builds.
