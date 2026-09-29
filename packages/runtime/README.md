# @clementina/runtime

The Clementina asset runtime is a ca65 library for loading built assets from SD and using them from a 65C02 game. It supplies explicit routines for palettes, tilesets, backgrounds, overlays, sprites, animation, songs, sounds, and video control. The TypeScript entry point exports the source manifest and descriptor constants used by `@clementina/build`.

The runtime gives games primitives; the game chooses when to load, draw, play, and tick assets. The [builder guide](../../docs/gamedev/builder.md) documents every ca65 macro, descriptor, memory rule, and result convention.

## Requirements

- Node.js 20 or newer for the TypeScript exports and SDK builder.
- `ca65`, `ld65`, and `ar65` from cc65 on `PATH` to assemble and link a game that uses the runtime.
- A Clementina assembly project with `clementina.yaml`, portable asset files, and a linker configuration. The game's startup code must clear BSS before calling the runtime. The game owns its slot layout and SD loading schedule.

The runtime uses the MIA index windows, command registers, and CPU bank selector. Calls leave those hardware settings changed. See [runtime conventions](../../docs/gamedev/builder.md#conventions) and the [compatibility notes](../../docs/compatibility.md) before choosing locations or calling routines from an interrupt handler.

## Use in an SDK asset build

Install the builder in a project or use this workspace's package. `@clementina/build` copies the runtime sources, assembles them with the project's `checks` setting, and writes `runtime.lib` alongside generated `assets.inc` and `assets.s`. Include `assets.inc` in your game source and link the generated library. The [runtime demo](../../examples/runtime-demo/) shows a complete project, linker configuration, BSS initialization, and calls to every public routine.

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

Carry clear means success. On failure, carry is set and `rt_error` holds an `RT_ERR_*` code. A load into MIA RAM can use `LoadStart`, `LoadBusy`, and `LoadWait` to let the game continue while SD works; bank loads finish before `LoadStart` returns.

## TypeScript exports

```ts
import {bankLocation, RUNTIME_DESCRIPTOR, runtimeDirectory, runtimeSources} from '@clementina/runtime';

const bankSlot = bankLocation(1, 0x8000); // 0x818000
console.log(RUNTIME_DESCRIPTOR.LOC);       // 1, the current-location offset
console.log(runtimeDirectory, runtimeSources);
```

`bankLocation` accepts banks 0–31 and addresses in the CPU `$8000–$BFFF` window, throwing `RangeError` for invalid arguments. `runtimeSources` lists the ca65 objects included in the archive; `runtimeIncludes` lists the public and internal include files. `runtimeFiles` holds the text of every source and include, generated from `asm/` by `npm run generate:runtime`, so the builder works without the package on disk (for example, inside the standalone CLI). The other `RUNTIME_*` exports mirror constants in `asm/runtime.inc`. Use `runtime.inc` (normally through generated `assets.inc`) for ca65 programs.

## Development

From the SDK workspace root, after `npm install`:

```sh
npm run build -w @clementina/runtime
npm run typecheck -w @clementina/runtime
npm run test -w @clementina/runtime
node --test tests/builder.test.mjs
```

The builder test assembles all ca65 modules with the real cc65 tools when they are available. The broader [emulator integration script](../../scripts/test-runtime-integration.mjs) takes paths to the Clementina automation and renderer executables and checks runtime state and a rendered 320×200 frame.
