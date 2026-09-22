# Program loading and BASIC bootstrap

The common Clementina runtime entry point is a small BASIC bootstrap. It loads
generated assets into MIA RAM, loads any returning banked CPU images, and finally
hands control to the main machine-code image. This uses the ROM's filesystem and
loaders on hardware and in the emulator.

Multiple assembly source files are a build concern. The assembler and linker
normally produce one logical PRG image; separate PRGs are useful for banked data,
overlays, or independently loaded modules. Portable project assets remain authoring
inputs. PRGs, raw MIA binaries, and the bootstrap are generated build outputs.

The final line uses `BLOAD`'s run argument:

```basic
10 MIALOAD "PALETTE.BIN",256,256
20 MIALOAD "TILES.BIN",512,6144
30 BLOAD "BANK1.PRG"
40 BLOAD "GAME.PRG",24576
```

`BLOAD "GAME.PRG",24576` loads the PRG according to its header and jumps to
`$6000`. It does not return to BASIC. A separate `BLOAD` followed by `SYS` is not
the standard takeover path: the ROM rejects a returning unbanked load into BASIC's
resident region at or above `$04B7`, since the load can overwrite the interpreter.
`SYS` remains appropriate for a machine-code subroutine that was loaded without
destroying BASIC and returns with `RTS`.

## Portable load plan

`specs/schema/load-plan.schema.json` defines format version 1. `@clementina/basic`
exports its types and deterministic helpers:

```ts
import {
  checkLoadPlan,
  encodePrg,
  inspectPrg,
  renderBootstrapSource,
  type LoadPlan,
} from '@clementina/basic';

const plan: LoadPlan = {
  format: 'clementina-load-plan',
  version: 1,
  steps: [
    {kind: 'mia', path: 'PALETTE.BIN', address: 0x100, length: 256},
    {kind: 'prg', path: 'BANK1.PRG', loadAddress: 0x8000, bank: 1, length: 0x4000},
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x6000, length: 8192, runAddress: 0x6000},
  ],
};

const source = renderBootstrapSource(plan);
const file = encodePrg(linkedBytes, 0x6000);
const info = inspectPrg(file);
```

Steps execute in array order. A plan must end with exactly one PRG step containing
`runAddress`; no later step could execute because the kernel jumps away permanently.
Returning PRG steps use `$8000-$BFFF` with an explicit bank 1-31. Although the ROM
loader can return from some lower unbanked addresses, the space below `$04B7` is
system zero page, stack, input, and kernel working RAM rather than portable program
storage. The SDK therefore does not generate returning unbanked loads. The terminal
image may be unbanked or banked. Payload bounds account for the loader's automatic
advance across extended-RAM banks.

MIA steps name the exact file length and must fit in the physical 256 KiB MIA RAM.
Lengths at most 65,535 are emitted as `MIALOAD`'s `maxlen`; larger exact files load
to EOF because the BASIC argument is only 16-bit. Paths are relative portable paths
inside the mounted build output and cannot contain traversal, quotes, backslashes,
or control characters. Generated lines must fit the ROM's 71-character input limit.
The SDK caps a plan at 6,399 steps so its line numbers, emitted in increments of
10, remain within the ROM BASIC line-number parser's range.

SD/FS state permanently occupies MIA RAM `$13000-$13BFF` (see
`docs/architecture/storage.md`). A `mia` step that overlaps that range always
fails validation; there is no acknowledgement escape, since nothing else has a
legitimate default claim on that range (the audio sequencer's tracks defaulted
there previously but are now relocatable and default elsewhere — see
`docs/compatibility.md`).

## BASIC terminal step

A plan may instead end with one `basic` step naming the compiled program file
(the raw `SAVE`/`LOAD` format from [BASIC tooling](basic-tooling.md), not a PRG):

```ts
const plan: LoadPlan = {
  format: 'clementina-load-plan',
  version: 1,
  steps: [
    {kind: 'mia', path: 'PALETTE.BIN', address: 0x100, length: 256},
    {kind: 'basic', path: 'GAME.BAS', length: 512},
  ],
};
```

A `basic` step is a terminal step like a returning-forbidden `prg` step with
`runAddress`; only one terminal step is allowed and it must be last.
`checkLoadPlanLaunch`/`renderLoadPlanLaunch` render this as `mode: 'direct'`:
every preceding step becomes the same `MIALOAD`/`BLOAD` command issued directly
(not through a numbered bootstrap), followed by `LOAD "GAME.BAS"` and `RUN`. An
assembly plan (ending in a returning `prg` step) instead renders `mode: 'numbered'`:
a temporary numbered bootstrap program, executed with `RUN`. Both modes share the
same `startCommand: 'RUN'`.

## Emulator launch

Start the Go automation server with the generated output mounted as its SD root:

```sh
clementina-automation -sd build
```

The path must be an existing directory. The server still binds only to loopback.
The SDK can then exercise the real ROM editor, tokenizer, MIA filesystem, `MIALOAD`,
and `BLOAD` path:

```ts
await client.addBreakpoint(0x6000);
await client.launchLoadPlan(plan);
```

`launchLoadPlan` resets the machine, advances a bounded boot budget, enters each
line from `renderLoadPlanLaunch` (numbered bootstrap lines for an assembly plan,
direct load/setup commands for a BASIC plan) through the text FIFO, and enters
`RUN`. It uses bounded cycle budgets while entering lines; these are test/tooling
budgets rather than a prompt-readiness protocol. The final `run` is asynchronous
and honors address breakpoints. Poll `state()` or pause explicitly as described in
`docs/emulator-automation.md`.

The SDK deliberately sends generated source through the ROM tokenizer rather than
implementing a second one. For standalone BASIC programs outside a load plan,
`@clementina/basic` can also directly emit and inspect the raw binary form consumed
by ROM `LOAD`; see [BASIC tooling](basic-tooling.md).

`@clementina/build` validates a portable project and, discriminated on
`program.kind`, either combines explicit manifest placement with ca65/ld65 output
and palette/CHR encoding into an assembly load plan, or compiles `program.entry`
through `@clementina/basic` into a BASIC load plan; both cases emit
`load-plan.json` alongside the generated files. CLI `build` calls that API. CLI
`run` then mounts the project root through the Node emulator lifecycle and passes
this same plan to `launchLoadPlan`, working for either project kind.
