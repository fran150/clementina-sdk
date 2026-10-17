# BASIC programming surface

Clementina ROM is a fork of Microsoft BASIC for 6502.

The ROM remains the detailed language authority. The SDK captures subsystem-facing
contracts needed by tools. The `keywords` section of `specs/basic.json` lists every
keyword with its kind, syntax line, arguments, the ranges the ROM accepts, and a
one-line summary; arguments outside a listed range raise `ILLEGAL QUANTITY`
unless the entry says otherwise. The `errors` section lists the 18 error
messages in the ROM's table order with what raises each, plus `?EXTRA IGNORED`,
`?REDO FROM START` and `BREAK`; `npm run check:drift` compares the messages and
their codes with a ROM build.

The SDK tokenizer and binary `SAVE`/`LOAD` file APIs are documented in
[BASIC tooling](../basic-tooling.md).

## Video
BASIC exposes video/layer switches, background modes/scrolling, CHR bank selection,
palettes, sprite/OAM commands, and DATA/file bulk asset operations.

## Input
It exposes source selection, held HID keys, mouse, four gamepads, and repeat settings.

## MIA memory
`MPEEK`, `MPOKE`, `MCOPY`, `MFILL` address raw MIA RAM 0..262143.

## Timing
`TICKS(0)`, `DELAY`, and `TI` use MIA wall time, independent of PHI2.

## Files
There are 16 BASIC file handles over MIA slots plus CPU `BLOAD/BRUN/BSAVE`,
MIA `MIALOAD/MIASAVE`, and asset load/save operations. Load and save commands
take the path first, then where, then how much.

CPU PRG convention: a 2-byte little-endian load address, then the data. The
file records no bank: `BANK n` (0-31) picks the bank that `BLOAD`, `BRUN`,
`BSAVE`, `PEEK`, `POKE` and `SYS` use at `$8000-$BFFF`. Each maps it only while
it works there and maps bank 0, which holds BASIC's strings, back.

Numbers can be written in hex: `$` and 1 to 6 hex digits, 0-16777215, enough for
any MIA RAM address (`MIALOAD "MAP.BIN",$14000`).

## Audio
BASIC drives four PSG voices and a MIA-side background sequencer.
The MIA repository documents the sequencer binary event format used by BASIC `TRACK`/`BAND`.
