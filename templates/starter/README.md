# Catch the Star

A starter project with a BASIC program and assembly code that it calls.

- `clementina.yaml` is the project manifest.
- `src/main.bas` is the BASIC program, the project's entry. Press `A` to
  catch the star and `R` to play again.
- `src/score.s` is the assembly code. The BASIC program calls `add_point`
  with `SYS 28672`, and it adds one point to the score at `$0280`, which
  BASIC reads with `PEEK(640)`.
- `link.cfg` places the assembly code at `$7000`, and `build.basic.memoryTop`
  keeps BASIC below it. The Clementina library is linked too:
  `.include "clementina-lib.inc"` to call its routines.
- The palette and palette config are assets; the build loads them before
  the program.
- `checks/smoke.json` presses `A` and expects the score on the screen, and
  `checks/code.json` expects it in memory at `$0280`. `clementina check`
  runs both.

A project doesn't need both parts. For BASIC only, remove `build.assembly`,
`memoryTop`, `link.cfg`, `src/score.s` and the `SYS`. For assembly only,
remove `program.entry`, `build.basic` and the `SCORE` code: the build then
starts the code at `entrySymbol`, which takes over the machine instead of
returning with `RTS`.

Building needs cc65; `clementina doctor` checks for it. From this folder:

```sh
clementina build
clementina run
clementina check
```
