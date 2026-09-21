# CPU memory map

| CPU range | Use |
| --- | --- |
| `$0000-$7FFF` | 32 KiB base RAM |
| `$8000-$BFFF` | 16 KiB banked window over 512 KiB extended RAM |
| `$C000-$DFFF` | eight 1 KiB I/O slots |
| `$E000-$FFFF` | MIA region |
| `$FFE0-$FFFF` | guaranteed 32-byte MIA register block |

Important base-RAM areas:

- `$0000-$00FF` zero page
- `$0100-$01FF` CPU stack
- `$0200-$02FF` line-input buffer
- `$0300-$03FF` kernel/editor variables
- `$0400-$04B6` fixed kernel working RAM
- `$04B7-$04E6` fixed kernel jump table
- from `$04E7` upward: linked kernel/WozMon/BASIC image, followed by BASIC heap

The current intended image is bottom-anchored at `$04B7`. Never hardcode the
current BASIC heap start because it moves as the ROM grows.

## Extended RAM

VIA Port A PA0-PA4 selects 32 banks. Bank 0 is BASIC's live high heap while BASIC
runs; bank-aware software may use banks 1-31 and must restore bank 0 before returning.

## I/O

The 65C22 VIA occupies `$C000-$C3FF`, mirrored every 16 bytes. Remaining I/O
slots are presently free.

Only `$FFE0-$FFFF` is guaranteed within the MIA CPU region; `$E000-$FFDF` is reserved.
