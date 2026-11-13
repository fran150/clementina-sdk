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
│   └── main.bas
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
  entry: src/main.bas
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

`target.phi2Hz` is optional; the machine default is 1.2 MHz. The hardware can
request other speeds, but SDK project builds and launches do not apply this
setting yet, so project validation rejects non-default values. The three audio
lists are optional, and a missing list means no assets of that kind; every other
list is required, even when it is empty.

## Program parts

A project is described by the parts it has, not by a kind:

- `program.entry` (optional) is a BASIC program. It runs last.
- `build.assembly` (optional) is ca65 code linked into one PRG.

A project needs at least one of them:

| Parts | What the loader does |
| --- | --- |
| BASIC only | Loads the assets, then `LOAD`s and `RUN`s the program. |
| Assembly only | A generated loader loads the assets and `BRUN`s the PRG, which takes over. |
| BASIC and assembly | Loads the assets, `BLOAD`s the PRG (it returns to BASIC), then `LOAD`s and `RUN`s the program, which calls the code with `SYS`. |

`program.entry` needs `build.basic` settings, and `build.basic` needs
`program.entry`. Asset builds (`build.assets`) need `build.assembly`, because the
runtime library is ca65 code.

## Build declaration

The build is explicit and reproducible. All paths remain project-relative.
The linker configuration owns CPU memory placement; the SDK verifies its output
against `loadAddress` rather than choosing an address.

```yaml
build:
  outputDirectory: build
  assembly:
    sources:
      - src/main.s
      - src/player.s
    linkerConfig: config/game.cfg
    outputName: game
    loadAddress: 24576       # $6000
    entrySymbol: game_start
    includeDirectories:
      - src/include
    defines:
      DEBUG: 1
  video:
    paletteConfigId: palette-config:main
    tilesets:
      - tilesetId: tileset:player
        bank: 3
```

Images linked at `$8000-$BFFF` must also declare a CPU `bank` from 1 through 31.
Each tileset placement names a distinct CHR bank from 0 through 7. The build emits
the selected complete palette configuration at MIA `$00100` and each tileset at
its declared CHR bank. No placement is inferred from manifest array order.

A BASIC program's settings name its output file and, optionally, where BASIC's
memory ends:

```yaml
program:
  entry: src/main.bas
build:
  outputDirectory: build
  basic:
    outputName: game
    memoryTop: 40960         # $A000
```

`memoryTop` lowers `MEMSIZ` before the program loads (`POKE 63,lo:POKE 64,hi:CLEAR`).
BASIC then keeps its program, variables and strings below it, so bank-0 RAM from
`memoryTop` to `$BFFF` is free for assembly the program calls with `SYS`. `FRE`
reports correspondingly less memory. The program text starts at the bottom of
BASIC's area, so lowering the top does not make room low in RAM: code at `$1800`
still overlaps the program. The value is from `$1600` (the kernel region's end;
BASIC's interpreter follows it, so the usable floor is higher and moves with each
ROM build) to `$C000` (the default).

## Memory layout

The manifest places every part: the PRG with `loadAddress` and `bank`, video data
with `build.video`, assets with `build.assets` slots, and BASIC's top with
`memoryTop`. The build never moves a part. It writes `memory-layout.json`, a map of
every part in CPU memory and MIA RAM next to the machine's own areas (system RAM,
the kernel, BASIC's workspace and the SD/FS state at MIA `$13000`), and warns
(`build.layout.overlap`) about each overlap. An overlap is a warning, not an error:
avoiding one, or overwriting BASIC on purpose, is the programmer's decision. An
assembly-only program takes over with `BRUN`, so overlapping BASIC is not reported
for it; overlapping the kernel, which holds the loader, is.

`@clementina/build` and `clementina build` produce the linked binary and PRG,
debug artifacts, palette/CHR files, `load-plan.json`, `memory-layout.json` and
`bootstrap.bas` inside `outputDirectory`. With `build.assets`, sprite files contain each tileset's
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
    loadAddress: 6144       # $1800; retain the resident kernel loader
    entrySymbol: game_start
  assets:
    folder: ASSETS
    checks: true
    slots:
      - {name: maps, mia: 0x14000, size: 32768}
      - {name: actors, bank: 1, address: 0x8000, size: 16384}
    include:
      - {kind: paletteConfig, id: palette-config:main, slot: palettes}
      - {kind: tileset, id: tileset:player, slot: chr2}
      - {kind: sprites, id: tileset:player, slot: actors, file: PLAYER.SPR}
      - {kind: background, id: background:level1, slot: maps}
```

Kinds are `paletteConfig`, `tileset`, `background`, `overlay`, `sprites`, `song`
and `sound`. A sprite file uses its **tileset ID**. `file` overrides the generated
8.3 name; names are unique ignoring case. `folder` defaults to `ASSETS` and
`checks` defaults to true. Built-in slots are `palettes`, `chr0`–`chr7` and
`overlay`; user MIA slots stay inside `$14000–$3FFFF`. CPU slots name a bank
1–31 and address `$8000–$BFFF`, and may span consecutive banks through bank 31.
Duplicate or unresolved includes, reserved locations and invalid assembly
constants are rejected. Overlapping slots are a warning
(`project.build.slot.overlap`). Assets sharing a slot are alternatives.

Output includes `assets.inc`, `assets.s`, `memory-report.json`, the runtime
sources/library/listings and `runtime/code-sizes.json`. The deployable card is
`build/sd`, containing `BOOT.BAS`, `GAME.PRG` and `ASSETS/`, plus the compiled
`<NAME>.BAS` when the project has a BASIC program. Runtime calls own
loading and playback; merely including an asset does not load or use it.
See [the Builder](gamedev/builder.md) and `examples/runtime-demo`.

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
