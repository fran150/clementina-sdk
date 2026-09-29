# @clementina/assembler

Node.js adapter for building Clementina 65C02 assembly programs with the
external `ca65` and `ld65` tools. It verifies the linked image before writing
a ROM-loadable PRG and exposes ld65 source maps for debuggers.

This package is a library used by `@clementina/build` and debugger integrations.
For complete portable projects with assets and a load plan, use
`@clementina/build` or the `clementina build` CLI command.

## Requirements

- Node.js 20 or newer.
- `ca65` and `ld65` from cc65 on `PATH`, or explicit command paths in
  `request.toolchain`.
- A project directory containing assembly sources and an ld65 linker
  configuration. The caller chooses the memory layout and entry symbol.

The package invokes tools directly, without a shell. It does not provide an
assembler, generate a linker configuration, or choose a load address.

## Build an assembly program

```ts
import {buildAssembly, createAssemblySourceMap} from '@clementina/assembler';

const built = await buildAssembly('/path/to/my-game', {
  sources: ['src/main.s', 'src/player.s'],
  linkerConfig: 'link.cfg',
  outputDirectory: 'build',
  outputName: 'game',
  loadAddress: 0x6000,
  entrySymbol: 'game_start',
});

if (!built.ok) {
  console.error(built.diagnostics);
} else {
  console.log(built.value.artifacts.prg); // build/game.prg
  const sourceMap = createAssemblySourceMap(built.value.debug, {
    bank: built.value.loadStep.bank,
  });
  console.log(sourceMap.locationsForSource('src/main.s', 12));
}
```

All request paths are relative to the project directory. `sources` are assembled
and linked in the supplied order. `outputName` is a filename stem without an
extension. A `bank` is required when `loadAddress` is in the banked
`$8000-$BFFF` CPU window, and is invalid outside that window. Optional
`includeDirectories`, `defines`, and `libraries` are passed to the tools;
define names are sorted for deterministic command lines.

The build writes a binary, PRG, ld65 debug data, map, labels, one object per
source, and ca65 listings to `outputDirectory`. The successful result contains
those project-relative artifact paths, the binary and PRG bytes, the entry
address, parsed debug records, and a terminal PRG load-plan step.

`buildAssembly` returns a `ValidationResult`. On failure, inspect
`diagnostics` rather than assuming the build threw. Diagnostics identify
invalid requests, tool failures, linked-image placement errors, PRG encoding
errors, and I/O errors. A failed build can leave intermediate tool output in
the build directory.

## Source maps

`parseCa65Debug(text)` parses ld65 version 2 debug records into files, lines,
segments, spans, and symbols. `createAssemblySourceMap(debug, {bank})` then
provides:

- `locationsForSource(path, line)`: mapped locations for an exact source line;
- `locationsForAddress(address, bank?)`: spans containing a CPU address;
- `executableLines(path)`: source lines with valid mapped spans.

Source paths use forward slashes and are case-sensitive. A line without a valid
mapped span has no source-map location. ld65 debug records do not carry Clementina's
selected RAM bank; pass the build result's bank when creating the map for a
banked program.

`runProcess` is the default tool runner. Tests and host integrations can pass
a `ProcessRunner` as the third argument to `buildAssembly`.

## Development

From the SDK workspace root:

```sh
npm run build -w @clementina/assembler
node --test tests/assembler.test.mjs
```

The tests cover debug parsing, source mapping, request validation, tool
failures, and a real ca65/ld65 build when those tools are available. The
workspace's `npm test` also exercises assembler output through the project
builder, CLI, and debugger.
