# Kernel fixed-address ABI

The stable jump table starts at `$04B7`. Every entry is a 3-byte `JMP`.

| Address | Symbol |
| --- | --- |
| `$04B7` | `KERN_COLDSTART` |
| `$04BA` | `KERN_WARMSTART` |
| `$04BD` | `KERN_CHROUT` |
| `$04C0` | `KERN_CHRIN` |
| `$04C3` | `KERN_GETKEY_NB` |
| `$04C6` | `KERN_STOP` |
| `$04C9` | `KERN_CLRSCR` |
| `$04CC` | `KERN_PRHEX` |
| `$04CF` | `KERN_PRBYTE` |
| `$04D2` | `KERN_PRSTR` |
| `$04D5` | `KERN_LOAD` |
| `$04D8` | `KERN_SAVE` (stub today) |
| `$04DB` | `KERN_EDITKEY` |
| `$04DE` | `KERN_CHROUT_GLYPH` |
| `$04E1` | `KERN_WOZMON` |
| `$04E4` | `KERN_SET_BACKDROP` |

Machine-readable form: `specs/kernel-abi.json`.
