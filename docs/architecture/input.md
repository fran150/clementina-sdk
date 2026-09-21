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
