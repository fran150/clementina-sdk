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

## IRQ read convention

Read `$FFF1` first if high IRQ bits matter. Reading `$FFF0` clears all latched
top-level IRQ flags and releases the physical IRQ line. Subsystem-specific flags
may require separate acknowledgement.

## Vectors

`$FFFA-$FFFF` are MIA-backed writable 6502 vectors. The kernel installs its
handlers during startup.
