# A Clementina project

A new Clementina project: a BASIC program that calls a routine in assembly.
It builds and runs as it is, and shows where everything goes.

- `clementina.yaml` is the project manifest.
- `src/main.cbas` is the BASIC program, the project's entry. It prints a
  line, calls the assembly routine with `SYS $7000`, and waits for a key.
- `src/hello.s` is the assembly routine `hello`. It prints a line through
  the kernel and returns to BASIC with `RTS`.
- `link.cfg` places the assembly code at `$7000`, and `build.basic.memoryTop`
  keeps BASIC below it. The Clementina library is linked too:
  `.include "clementina-lib.inc"` to call its routines.
- The palette and palette config are assets; the build loads them before
  the program.
- `checks/smoke.json` expects the routine's line on the screen, presses `A`,
  and expects the program's answer. `clementina check` runs it.

A project doesn't need both parts. For BASIC only, remove `build.assembly`,
`memoryTop`, `link.cfg`, `src/hello.s` and the `SYS`. For assembly only,
remove `program.entry`, `build.basic` and `src/main.cbas`: the build then
starts the code at `entrySymbol`, which takes over the machine instead of
returning with `RTS`.

The SDK's `examples/catch-the-star` is a complete game built from this
starter.

From this folder:

```sh
clementina build
clementina check
```
