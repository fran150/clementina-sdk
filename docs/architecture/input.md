# Input architecture

One active source feeds a common interface:

- console
- Wi-Fi
- USB host

The CPU can consume a 64-byte text FIFO, held keyboard/consumer HID bitmaps,
mouse state, four gamepads, source/capability flags, and event flags.

Wi-Fi input uses UDP port 6503.

The fixed state block is `$11000-$1107F`:
keyboard bitmap, consumer bitmap, mouse, event controls, four gamepads, and wall-time snapshot.

Mouse movement is stored as wrapping byte accumulators; subtract samples as signed
8-bit values. Programs may poll input; IRQ handling is optional.

Text input is independent from held-state queries, which is important for games.

The 32-byte HID bitmaps use bit `usageId & 7` in byte `usageId >> 3` for usage IDs
0–255. Keyboard/Keypad is page 7 at `$11000`; Consumer is page 12 at `$11020`.

Each gamepad slot is a 10-byte record starting at `$11050 + player * 10`:

| Byte | Value |
| ---: | --- |
| 0 | D-pad: up 1, down 2, left 4, right 8; Sony labels 64; connected 128 |
| 1 | Digital stick directions: left up/down/left/right in bits 0–3, right in bits 4–7 |
| 2–3 | Button bits 0–15, low byte first |
| 4–7 | Left X/Y, right X/Y, each signed 8-bit |
| 8–9 | Left and right trigger, each unsigned 8-bit |

Button bits 0–14 mean A/Cross, B/Circle, C/right paddle, X/Square, Y/Triangle,
Z/left paddle, L1, R1, L2, R2, Select/Back, Start/Menu, Home, L3, R3.
Bit 15 is reserved. Analog stick values range from −128 to 127. The input
source derives digital stick bits from analog values; automation callers supply
the complete record explicitly.
