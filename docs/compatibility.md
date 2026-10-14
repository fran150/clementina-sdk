# Current compatibility notes

## Verification scope

The [asset runtime](gamedev/builder.md) and [runtime demo](../examples/runtime-demo/)
have emulator integration coverage. A physical Pico runtime test and audio
signal capture are not recorded here. Emulator register snapshots verify
programmed audio state, not the PWM signal on a physical board.
The [physical verification procedure](hardware-verification.md) supplies a
repeatable runtime fixture and audio capture workflow for recording those results.
