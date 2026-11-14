# @clementina/lib

The Clementina library is the SDK's library of 6502 routines for Clementina programs, written for ca65. It gives a program higher-level operations than driving the hardware by hand, so the program's own code can stay about the program. Its first sections load files from the SD card and use them: palettes, tilesets, backgrounds, overlays, sprites and animation, songs and sound effects. Others control video, pace the main loop and read gamepads and the keyboard. The SDK adds sections as programs need them. The TypeScript entry point exports the embedded sources and the descriptor constants used by `@clementina/build`.

The library gives programs primitives; the program chooses when to load, draw, play, and tick. The [library guide](../../docs/gamedev/library.md) documents every ca65 macro, memory rule, and result convention, and the [builder guide](../../docs/gamedev/builder.md) documents the asset files and descriptors.

## Requirements

- Node.js 20 or newer for the TypeScript exports and SDK builder.
- `ca65`, `ld65`, and `ar65` from cc65 on `PATH` to assemble and link a program.
- A Clementina project with `build.assembly` in its `clementina.yaml` and a linker configuration that places `ZEROPAGE`, `CODE`, `RODATA`, `DATA`, and `BSS`. The program's startup code must clear BSS before calling the library. To load assets, the project also declares `build.assets`; the program owns its slot layout and SD loading schedule.

The library uses the MIA index windows, command registers, and CPU bank selector. Calls leave those hardware settings changed. See [the library's conventions](../../docs/gamedev/library.md#conventions) before choosing locations or calling routines from an interrupt handler.

## Use in an SDK build

`@clementina/build` writes the library's sources into `<outputDirectory>/lib/`, assembles them with the project's `build.assembly.checks` setting, archives them into `clementina.lib`, and links it into every assembly program. `ld65` takes only the modules the program calls. Include `clementina-lib.inc`, or the generated `assets.inc`, which includes it. The [library demo](../../examples/library-demo/) shows a complete project, linker configuration, BSS initialization, and calls to every public routine.

For example, after initializing BSS:

```asm
.setcpu "65C02"
.include "assets.inc"

; PAL_MAIN and BG_LEVEL1 are labels generated from the project's assets.
Load PAL_MAIN
bcs load_failed
UsePalettes PAL_MAIN
bcs load_failed
Load BG_LEVEL1
bcs load_failed
DrawScreen BG_LEVEL1, #0, #0, #0
bcs load_failed
```

Carry clear means success. On failure, carry is set and `cl_error` holds a `CL_ERR_*` code. A load into MIA RAM can use `LoadStart`, `LoadBusy`, and `LoadWait` to let the program continue while SD works; bank loads finish before `LoadStart` returns.

## TypeScript exports

```ts
import {bankLocation, LIBRARY_DESCRIPTOR, libraryDirectory, librarySources} from '@clementina/lib';

const bankSlot = bankLocation(1, 0x8000); // 0x818000
console.log(LIBRARY_DESCRIPTOR.LOC);       // 1, the current-location offset
console.log(libraryDirectory, librarySources);
```

`bankLocation` accepts banks 0–31 and addresses in the CPU `$8000–$BFFF` window, throwing `RangeError` for invalid arguments. `librarySources` lists the ca65 objects included in the archive; `libraryIncludes` lists the public and internal include files. `libraryFiles` holds the text of every source and include, generated from `asm/` by `npm run generate:library`, so the builder works without the package on disk (for example, inside the standalone CLI). The other `LIBRARY_*` exports mirror constants in `asm/clementina-lib.inc`. Use `clementina-lib.inc` for ca65 programs.

## Development

From the SDK workspace root, after `npm install`:

```sh
npm run build -w @clementina/lib
npm run typecheck -w @clementina/lib
npm run test -w @clementina/lib
node --test tests/builder.test.mjs
```

The builder test assembles all ca65 modules with the real cc65 tools when they are available. The broader [emulator integration script](../../scripts/test-library-integration.mjs) takes paths to the Clementina automation and renderer executables and checks library state and a rendered 320×200 frame.
