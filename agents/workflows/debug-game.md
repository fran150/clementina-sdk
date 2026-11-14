# Debug a game

Reproduce the issue with a portable project, then read the relevant machine
spec and source. The debugger supports BASIC and assembly projects.

1. Find an executable physical source line just after the state you want to
   inspect. This is the line in the file, not a BASIC line label.
2. Run:

```sh
clementina debug <project> --line 124 --source src/main.s --memory '$0280:16'
```

`--source` defaults to the manifest's `program.entry`, else the first assembly
source. `--memory` is an optional CPU address and byte count; the address may be
decimal, `$hex` or `0xhex` (quote `$` in a shell). `--emulator` names an
automation executable other than `clementina-automation` on `PATH`. `--timeout` sets the host wait limit in
milliseconds. The command builds with SDK APIs, configures a verified source
breakpoint before launch, waits for that stop, saves CPU/register/source and
optional memory in `<outputDirectory>/inspection/debug-report.json`, and saves
native MIA video state as `debug.video.bin`. It closes the owned emulator. `node agents/workflows/debug-game.mjs` takes the
same options from an SDK checkout.

3. Compare the report and video state with the spec. For a visual PNG, use
   [the character workflow](create-character.md) with `clementina-render`,
   or the [code workflow](code-game.md) for before/after snapshots.
4. Make the smallest source or asset change, add a repeatable check in
   `checks/code.json` or `checks/smoke.json`, and run the code workflow.

Logical address breakpoints in the banked CPU window are not bank selective;
disassembly and stack unwinding remain outside the current debugger.
