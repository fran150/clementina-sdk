# Current compatibility notes

## Verification scope

The [asset runtime](gamedev/builder.md) and [runtime demo](../examples/runtime-demo/)
have emulator integration coverage only: neither has been run on a physical
board. Emulator register snapshots verify programmed audio state, not the PWM
signal on a physical board.

Audio output was checked by ear on the breadboard build on 2026-11-11, with the
[hardware audio example](../examples/hardware-audio/) (MIA firmware after the
audio timer fix): the 440 Hz left and 880 Hz right voices played at the expected
pitch and pan, and releasing the gate silenced them. No signal capture was
recorded. The [physical verification procedure](hardware-verification.md)
describes the runtime fixture and audio capture workflow for a recorded run.
