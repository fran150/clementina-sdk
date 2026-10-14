# Current compatibility notes

## Audio playback limits

ROM `TRACK` emits adjacent notes without turning the gate off, so they do not
retrigger the envelope like non-legato notes compiled by the SDK. The sequencer
has no instantaneous frequency-only opcode for smooth pitch slides.

## Verification scope

The [asset runtime](gamedev/builder.md) and [runtime demo](../examples/runtime-demo/)
have emulator integration coverage. A physical Pico runtime test and audio
signal capture are not recorded here. Emulator register snapshots verify
programmed audio state, not the PWM signal on a physical board.
The [physical verification procedure](hardware-verification.md) supplies a
repeatable runtime fixture and audio capture workflow for recording those results.
