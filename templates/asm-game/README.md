# Assembly game starter

This portable `clementina.yaml` project builds a 65C02 program at the
explicit `$1800` address. The program writes 42 to CPU RAM `$0200`, then
loops. Its `checks/code.json` makes that behavior repeatable in the emulator.

From the SDK root:

```sh
node agents/workflows/create-game.mjs init /path/to/new-game --kind assembly
node agents/workflows/code-game.mjs /path/to/new-game --emulator /path/to/clementina-automation
```

Edit `src/main.s` and `link.cfg` deliberately as the game grows. The
linker configuration chooses CPU placement; the SDK verifies it but does
not choose a memory map. Add portable assets to the manifest, then use
`build.assets` and the SDK runtime as described in
`docs/gamedev/builder.md`.
