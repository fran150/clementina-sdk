# Multi-bank rooms

A small program whose assembly code lives in two banks of extended RAM.
BASIC asks for a room, and the room's code, in bank 1 or bank 2, prints it
inside a frame.

- `src/main.cbas` is the BASIC program. It POKEs the room number into
  `$0280` and calls `show_room` with `SYS $7000`.
- `src/common.s` is the shared code at `$7000`, below the banked window
  `$8000-$BFFF`, so it is there whichever bank is mapped. `show_room` picks the
  room, and `far_call` maps a bank, calls a routine in it and maps the caller's
  bank again. Only this code writes `VIA_ORA`, the register that picks the bank.
- `src/bank1.s` is bank 1: the gate, and `frame`, the border both rooms draw.
- `src/bank2.s` is bank 2: the cave. Its frame is in bank 1, so it calls it
  with `FarCall frame`, which goes through `far_call` and comes back to bank 2.
- `src/far.inc` has the `FarCall` and `Print` macros. `FarCall` uses ca65's
  `.bank(routine)`, the bank that `link.cfg` gives the routine's area.
- `link.cfg` puts the shared code at `$7000` and gives each bank an area at
  `$8000` with its own output file and `bank = n`. `build.assembly.banks` in
  `clementina.yaml` lists the two areas, so the build makes `CODE.BANK1.PRG`
  and `CODE.BANK2.PRG`, and `BOOT.BAS` loads them with
  `BANK 1:BLOAD "CODE.BANK1.PRG"` and `BANK 2:BLOAD "CODE.BANK2.PRG"` before
  the shared code.
- `build.basic.memoryTop` keeps BASIC below `$7000`. BASIC uses bank 0 at
  `$8000-$BFFF`, so the rooms are in banks 1 and 2, and every call returns
  with bank 0 mapped.
- `checks/smoke.json` asks for room 2 and expects the cave.

Code in a bank must not write `VIA_ORA` itself: the next instruction would come
from the new bank. The VS Code extension warns about such a store, and the
debugger's `stopOnBankSwitch` launch attribute stops on one.

From this folder:

```sh
clementina build
clementina-emulator --sd build/sd
```

Then type `RUN "BOOT.BAS"` in the video client and answer `1` or `2`.
`clementina check` runs it headless and tests the smoke check.
