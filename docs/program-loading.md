# Program loading and BASIC bootstrap

## Builder card folder

An assembly project with `build.assets` emits a standalone SD folder at
`<outputDirectory>/sd`: `<NAME>.PRG`, tokenized `BOOT.BAS` and the configured
asset folder (default `ASSETS`). `assets.inc`, `assets.s`, runtime sources,
`runtime.lib` and reports stay in the parent output folder. Copy the **contents**
of `sd` to the card. From that directory, `LOAD "BOOT.BAS"` and `RUN` load the
program. The game then loads its assets through the runtime.

`buildProject().value.sdRoot` is project-relative. CLI `run`, SDK debug sessions
and Studio mount `resolve(projectRoot, build.sdRoot)`; load-plan paths are
relative to that mount. Builds without `build.assets` retain `sdRoot: "."`.
Load runtime games at `$1800` or higher so BRUN's resident loader survives: the
kernel, which holds the loader, ends below `$1600`, and `$1800` leaves some room.


The common Clementina runtime entry point is a small BASIC bootstrap. It loads
generated assets into MIA RAM, loads any returning banked CPU images, and finally
hands control to the main machine-code image. This uses the ROM's filesystem and
loaders on hardware and in the emulator. An assembly project already generates
this BASIC bootstrap; it does not need `program.kind: mixed`.

Multiple assembly source files are a build concern. The assembler and linker
normally produce one logical PRG image; separate PRGs are useful for banked data,
overlays, or independently loaded modules. Portable project assets remain authoring
inputs. PRGs, raw MIA binaries, and the bootstrap are generated build outputs.

Each PRG step picks its bank with `BANK` first, and the final line uses `BRUN`:

```basic
10 MIALOAD "PALETTE.BIN",256
20 MIALOAD "TILES.BIN",512
30 BANK 1:BLOAD "BANK1.PRG"
40 BANK 0:BRUN "GAME.PRG"
```

`BANK n` picks the bank that `BLOAD` and `BRUN` load into from `$8000` up; the
bootstrap writes it only when it changes, and always before the first PRG.
`BRUN "GAME.PRG"` loads the PRG at its header address and jumps to its first
byte, or to `BRUN "GAME.PRG",run` when the entry point is elsewhere in the image.
It does not return to BASIC. A separate `BLOAD` followed by `SYS` is not the
standard takeover path: the ROM loads wherever the file says, so a returning load
at or above `$0400` may overwrite the kernel or the interpreter it returns to.
`SYS` remains appropriate for a machine-code subroutine that was loaded without
destroying BASIC and returns with `RTS`: below `$0400` (`$0280-$02F7` is free), in
banks 1-31, or in bank 0 above a lowered `MEMSIZ` (`POKE 63,lo:POKE 64,hi:CLEAR`).

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

Steps execute in array order. An assembly plan ends with exactly one PRG step
containing `runAddress`; no later step could execute because the kernel jumps away
permanently. A BASIC plan ends with the `basic` step described below.
A PRG file holds only its 2-byte load address; a step's `bank` (0-31, 0 when left
out) is the one `BANK` picks before loading it, for the bytes from `$8000` up.
Returning PRG steps normally use `$8000-$BFFF` with a bank 1-31, which BASIC never
touches. The ROM loads a returning PRG anywhere, so the check only warns
(`load.prg.return`) about a returning unbanked or bank-0 step: below `$0400` is
system zero page, stack, input buffers and kernel variables, and from `$0400` up
through bank 0 the load may overwrite the kernel or BASIC unless the program lowered
`MEMSIZ`. The terminal image may be unbanked or banked, in any bank 0-31. Payload
bounds account for the loader's automatic advance across extended-RAM banks.

MIA steps name the exact file length and must fit in the physical 256 KiB MIA RAM.
`MIALOAD` always loads the whole file, so the length is only checked, not emitted.
Paths are relative portable paths
inside the mounted build output and cannot contain traversal, quotes, backslashes,
or control characters. Generated lines must fit the ROM's 80-character input limit.
The SDK caps a plan at 6,399 steps so its line numbers, emitted in increments of
10, remain within the ROM BASIC line-number parser's range.

SD/FS state permanently occupies MIA RAM `$13000-$13BFF` (see
`docs/architecture/storage.md`). A `mia` step that overlaps that range gets a
`load.mia.reserved` warning: MIA loads it over the state that later file
commands, including the rest of the plan, rely on. Nothing else has a default
claim on that range: sequencer tracks have no default address (see
`docs/architecture/audio.md`).

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
(not through a numbered bootstrap), followed by `LOAD "GAME.BAS"` and `RUN`
(`BANK 0:LOAD "GAME.BAS"` when an earlier step picked another bank). An
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
`BANK` and `BRUN` path:

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
The default per-line processing budget is 1,000,000 cycles so a preceding ROM
filesystem command can complete before the next line is entered. Callers can
override it with `inputCycles` for a particular emulator test.

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
