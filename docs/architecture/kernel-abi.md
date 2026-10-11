# Kernel fixed-address ABI

The stable jump table starts at `$04B7`. Every entry is a 3-byte `JMP`.

| Address | Symbol |
| --- | --- |
| `$04B7` | `KERN_COLDSTART` |
| `$04BA` | `KERN_WARMSTART` |
| `$04BD` | `KERN_CHROUT` |
| `$04C0` | `KERN_CHRIN` |
| `$04C3` | `KERN_GETKEY_NB` |
| `$04C6` | `KERN_CLRSCR` |
| `$04C9` | `KERN_PRHEX` |
| `$04CC` | `KERN_PRBYTE` |
| `$04CF` | `KERN_PRSTR` |
| `$04D2` | `KERN_LOAD` |
| `$04D5` | `KERN_EDITKEY` |
| `$04D8` | `KERN_CHROUT_GLYPH` |
| `$04DB` | `KERN_WOZMON` |
| `$04DE` | `KERN_SET_BACKDROP` |

Machine-readable form: `specs/kernel-abi.json`.
