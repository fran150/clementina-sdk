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

The current audio-sequencer and SD/FS regions overlap at `$13000-$13FFF`. A plan
touching this range fails validation unless it explicitly includes:

```json
{"acknowledgedIssues":["audio-sequencer-sd-memory-overlap"]}
```

Acknowledgement records an intentional address choice; it does not claim that both
subsystems can safely use the bytes simultaneously or resolve the upstream issue.

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
generated numbered line through the text FIFO, and enters `RUN`. It uses bounded
cycle budgets while entering lines; these are test/tooling budgets rather than a
prompt-readiness protocol. The final `run` is asynchronous and honors address
breakpoints. Poll `state()` or pause explicitly as described in
`docs/emulator-automation.md`.

The SDK deliberately sends source through the ROM tokenizer. Tokenized BASIC file
generation belongs to the later BASIC tooling phase. The same bootstrap can be
entered and saved on a machine today; a future tokenizer will emit its saved form
without changing the load-plan contract.

`@clementina/build` now combines explicit manifest placement, ca65/ld65 output,
and palette/CHR encoding into the files described by this plan. CLI `build` calls
that API. Emulator process lifecycle and CLI `run` remain the next layer.
