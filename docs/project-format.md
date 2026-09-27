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
  kind: basic
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

`target.phi2Hz` is optional; the machine default is 1.2 MHz. The three audio
lists are optional, and a missing list means no assets of that kind; every other
list is required, even when it is empty.

## Build declaration

Assembly projects can declare an explicit reproducible build. All paths
remain project-relative. The linker configuration owns CPU memory placement; the
SDK verifies its output against `loadAddress` rather than choosing an address.

```yaml
program:
  kind: assembly
  entry: src/main.s
  sources:
    - src/player.s
build:
  outputDirectory: build
  assembly:
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

`@clementina/build` and `clementina build` produce the linked binary and PRG,
debug artifacts, palette/CHR files, `load-plan.json`, and `bootstrap.bas` inside
`outputDirectory`. With `build.assets`, sprite files contain each tileset's
shapes followed by animations, with generated item/location tables.

## Asset build (`build.assets`)

For an assembly project, add:

```yaml
build:
  outputDirectory: build
  assembly:
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
Overlapping slots, duplicate or unresolved includes, reserved locations and
invalid assembly constants are rejected. Assets sharing a slot are alternatives.

Output includes `assets.inc`, `assets.s`, `memory-report.json`, the runtime
sources/library/listings and `runtime/code-sizes.json`. The deployable card is
`build/sd`, containing `BOOT.BAS`, `GAME.PRG` and `ASSETS/`. Runtime calls own
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
the notes on one voice must not overlap. A sound effect is one voice's register
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
