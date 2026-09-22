# BASIC programming surface

Clementina ROM is a fork of Microsoft BASIC for 6502.

The ROM remains the detailed language authority. The SDK captures subsystem-facing
contracts needed by tools.

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
There are 16 BASIC file handles over MIA slots plus CPU `BLOAD/BSAVE`,
MIA `MIALOAD/MIASAVE`, and asset load/save operations.

CPU PRG convention:
- unbanked: 2-byte little-endian load address
- banked `$8000-$BFFF`: load address plus explicit bank byte 1-31

## Audio
BASIC drives four PSG voices and a MIA-side background sequencer.
The MIA repository documents the sequencer binary event format used by BASIC `TRACK`/`BAND`.
