# Kernel fixed-address ABI

The stable jump table starts at `$0400`, the first byte of the loaded image.
Every entry is a 3-byte `JMP`. New entries are appended at the end, so an
existing address never changes.

| Address | Symbol |
| --- | --- |
| `$0400` | `KERN_COLDSTART` |
| `$0403` | `KERN_WARMSTART` |
| `$0406` | `KERN_CHROUT` |
| `$0409` | `KERN_CHRIN` |
| `$040C` | `KERN_GETKEY_NB` |
| `$040F` | `KERN_CLRSCR` |
| `$0412` | `KERN_PRHEX` |
| `$0415` | `KERN_PRBYTE` |
| `$0418` | `KERN_PRSTR` |
| `$041B` | `KERN_LOAD` |
| `$041E` | `KERN_EDITKEY` |
| `$0421` | `KERN_CHROUT_GLYPH` |
| `$0424` | `KERN_WOZMON` |
| `$0427` | `KERN_SET_BACKDROP` |
| `$042A` | `KERN_IRQ` |
| `$042D` | `KERN_PLOT` |
| `$0430` | `KERN_RDTIM` |
| `$0433` | `KERN_SETTIM` |

`KERN_IRQ` is the kernel's IRQ handler. A program that points `IRQ_VEC`
(`$FFFE`) at its own handler restores A, X and Y and ends with `JMP KERN_IRQ`
so the kernel's tick counter (`KJIFFY`, `$F7-$F8`) and cursor blink keep
working. `KERN_WARMSTART` puts the kernel's handler back. The rules are in
clementina-rom `docs/memory-map.md` §6.

`KERN_PLOT` reads (C=1) or moves (C=0) the text cursor with the C64's
registers: X is the row (0-24), Y the column (0-39). A move to an
out-of-range position returns C=1 and does nothing.

`KERN_RDTIM` copies MIA's clock to a fixed snapshot and returns C=1 when MIA
supports the clock:

| Address | Size | Contents |
| --- | --- | --- |
| `$02F8` | 4 | Milliseconds since MIA reset, little-endian |
| `$02FC` | 3 | 60 Hz count, little-endian, wraps at 5,184,000 (24 hours); BASIC's `TI` |
| `$02FF` | 1 | Version, 1 when valid |

The snapshot changes only when `KERN_RDTIM` runs, and BASIC's `TI`, `TICKS`
and `DELAY` also call it. `KERN_SETTIM` sets the 60 Hz count from A (low),
X (middle) and Y (high); MIA ignores values of 5,184,000 or more.

Machine-readable form: `specs/kernel-abi.json`.
