# Assembly game starter

This portable `clementina.yaml` project builds a 65C02 program at the
explicit `$1800` address. The program writes 42 to CPU RAM `$0200`, then
loops. Its `checks/code.json` makes that behavior repeatable in the emulator.

Building needs cc65 (`ca65` and `ld65`); `clementina doctor` checks for it.
From this folder:

```sh
clementina project validate
clementina build
clementina run
```

Edit `src/main.s` and `link.cfg` deliberately as the game grows. The
linker configuration chooses CPU placement; the SDK verifies it but does
not choose a memory map. Add portable assets to the manifest and use
`build.assets` with the SDK runtime to load them.
