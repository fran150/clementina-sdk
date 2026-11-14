# Starter project

This portable `clementina.yaml` project builds a 65C02 program at the
explicit `$1800` address. The program writes 42 to CPU RAM `$0200`, then
loops. Its `checks/code.json` makes that behavior repeatable in the emulator.

This starter begins with assembly code. A project can have assembly code, a
BASIC program, or both: add a BASIC `program.entry` to `clementina.yaml` and the
build loads this code first, then runs the BASIC program, which can call it.

Building needs cc65 (`ca65` and `ld65`); `clementina doctor` checks for it.
From this folder:

```sh
clementina project validate
clementina build
clementina run
clementina check
```

Edit `src/main.s` and `link.cfg` deliberately as the game grows. The
linker configuration chooses CPU placement; the SDK verifies it but does
not choose a memory map. Its segments already have room for the Clementina
library, which every build links: `.include "clementina-lib.inc"` and call
its routines, after clearing BSS. Add portable assets to the manifest and
`build.assets` to load them through the library.
