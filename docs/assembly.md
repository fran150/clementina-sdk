# Assembly builds

`@clementina/assembler` is the reusable Node adapter for ca65 and ld65. It is the
assembly foundation for CLI `build` and the future source debugger. It does
not depend on Studio or the emulator.

The caller supplies all placement decisions:

- assembly sources in link order;
- an ld65 linker configuration;
- the expected CPU load address;
- a bank when the image loads at `$8000-$BFFF`;
- the entry symbol;
- an output directory and filename stem.

The SDK does not infer a load address or rewrite the linker configuration. After
linking, it reads ld65's `.dbg` output and checks that every emitted segment starts
at `loadAddress + outputOffset`. Separate output files and entry symbols outside
the linked payload are rejected. This prevents a PRG header from claiming an
address that disagrees with the linked image.

```ts
import {buildAssembly, createAssemblySourceMap} from '@clementina/assembler';

const built = await buildAssembly('/projects/my-game', {
  sources: ['src/main.s', 'src/player.s'],
  linkerConfig: 'config/game.cfg',
  outputDirectory: 'build',
  outputName: 'game',
  loadAddress: 0x6000,
  entrySymbol: 'game_start',
  includeDirectories: ['src/include'],
});

if (!built.ok) console.error(built.diagnostics);
else {
  const sourceMap = createAssemblySourceMap(built.value.debug, {
    bank: built.value.loadStep.bank,
  });
  console.log(sourceMap.locationsForSource('src/main.s', 12));
}
```

The result includes the raw binary, loader-compatible PRG, a terminal load-plan
step, normalized source/debug records, and paths for objects, listings, map,
labels, and debug data. Tool failures are returned as structured diagnostics.
Processes are launched directly without a shell.

The adapter currently requires ld65 debug format major version 2. It parses every
span attached to a source line and maps `segment.start + span.start` to a logical
CPU address. `locationsForSource` resolves an exact line, `locationsForAddress`
returns every containing source span, and `executableLines` lists the lines that
actually emitted bytes. Paths use normalized POSIX separators and remain
case-sensitive. Lines without emitted spans are deliberately left unresolved.

ld65 v2 debug records do not include Clementina's selected RAM bank. Pass the bank
from the verified assembly build when creating the map. The resulting source
locations retain that bank metadata for addresses in `$8000-$BFFF`.

Portable project build declarations are documented in
[the project format](project-format.md), and
`@clementina/build` composes assembler and video outputs into the load plan used by
CLI `build`. CLI `run` composes that output with the owned emulator process API.
Shape and animation runtime files will wait for an explicit binary ABI.
