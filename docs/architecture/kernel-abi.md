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

`KERN_IRQ` is the kernel's IRQ handler. A program that points `IRQ_VEC`
(`$FFFE`) at its own handler restores A, X and Y and ends with `JMP KERN_IRQ`
so the kernel's tick counter (`KJIFFY`, `$F7-$F8`) and cursor blink keep
working. `KERN_WARMSTART` puts the kernel's handler back. The rules are in
clementina-rom `docs/memory-map.md` §6.

Machine-readable form: `specs/kernel-abi.json`.
