# MIA programming model

MIA has a 32-byte CPU register window at `$FFE0-$FFFF` plus 256 KiB of separate RAM.

## Indexed RAM

There are 256 descriptors and two active windows, A and B. Each descriptor has:

- 24-bit current address
- 24-bit default address
- 24-bit exclusive limit
- 16-bit step magnitude
- flags: read-step, write-step, direction, wrap, wrap-IRQ

Window A: `$FFE0/$FFE1`. Window B: `$FFE4/$FFE5`.
Configuration: `$FFE2/$FFE3`.

## Commands

Write parameters to `$FFE6-$FFE8`, then a command id to `$FFE9`.
See `specs/mia-commands.json`.

Two commands copy inside MIA RAM, and neither moves the descriptors.
- `COPY_INDEXES` (`$10`) copies one run of bytes.
- `COPY_RECT` (`$11`) copies a rectangle. p1 is the source descriptor, p2 the
  destination descriptor, and p3 the row count (0 means 256). Each row is as
  long as the source's limit minus its current address. After each row, each
  address advances by its own descriptor's step; a source step of 0 repeats
  the first row.
- A copy requested while another is running waits behind it, up to eight deep.
  A full queue reports error `$13`.

## Context stack

`MIA_CTX` (`$FFF5`) lets an interrupt handler use the windows, configuration
registers and command parameters without disturbing the code it interrupted.

- Writing `$01` saves `IDXA_SELECT`, `IDXB_SELECT`, `CFG_SELECT`,
  `CMD_PARAM1-3`, and the full records of the two descriptors bound to the
  windows.
- Writing `$02` restores them and reloads both data ports and `CFG_PORT`.
- The stack is four deep. Overflow queues error `$22` and underflow `$23`.
- Other descriptors, and commands the handler triggered, are not undone.
- A command reads its descriptors when MIA runs it, not when it is triggered.
  A handler that triggers one on a descriptor the pop restores must wait for
  `MIA_STAT_CMD_RUNNING` to clear before popping.

## IRQ read convention

Read `$FFF1` first if high IRQ bits matter. Reading `$FFF0` clears all latched
top-level IRQ flags and releases the physical IRQ line. Subsystem-specific flags
may require separate acknowledgement.

## Vectors

`$FFFA-$FFFF` are MIA-backed writable 6502 vectors. The kernel installs its
handlers during startup.
