# Portable Clementina project format

Phase 2 separates **portable project data** from Studio session state.

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
    ├── shapes/
    └── animations/
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
  shapes:
    - assets/shapes/player_idle.shape.json
  animations:
    - assets/animations/player_idle.animation.json
```

`target.phi2Hz` is optional; the machine default is 1.2 MHz.

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
`outputDirectory`. Shape and animation files are not emitted because their runtime
binary ABI is not defined yet.

## Portable asset envelopes

Every asset is self-identifying and versioned:

| Asset | `format` | Version |
| --- | --- | ---: |
| palette | `clementina-palette` | 1 |
| palette config | `clementina-palette-config` | 1 |
| tileset | `clementina-tileset` | 1 |
| shape | `clementina-shape` | 1 |
| animation | `clementina-animation` | 1 |

JSON Schemas live in `specs/schema/`.

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

## What Phase 2 does not define yet

Scene files, room/background maps, audio authoring assets, shape/animation runtime
packing, and BASIC-project build composition remain later phases. The standalone
BASIC tokenizer and file compiler are documented in [BASIC tooling](basic-tooling.md).
