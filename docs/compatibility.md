# Current compatibility notes

## Audio sequencer and SD/FS MIA RAM (resolved)

Audio sequencer track buffers used to default into `$13000-$13FFF`, overlapping
SD/FS state at `$13000-$13BFF`. Current MIA firmware and emulator code have
resolved this: sequencer tracks are relocatable (`AUDIO_SEQ_SET_BASE0-3`,
commands `$68-$6B`), have no per-track size cap, and have no default address at
all: a voice has no track until the program sets its base. See
`docs/architecture/audio.md` and `specs/known-issues.json` (status `resolved`)
for the full contract and reconciliation record.

SD/FS's own `$13000-$13BFF` region remains permanently reserved for its
control/sector/path/dir/transfer state, independent of audio. `@clementina/basic`'s
load-plan validation warns (`load.mia.reserved`) about any MIA load step that
overlaps it: the load goes ahead, but later file commands rely on that state (see
`docs/program-loading.md`). A caller relocating a sequencer track with
an explicit `AUDIO_SEQ_SET_BASE` address is responsible for avoiding SD/FS state
and other reserved regions themselves — the SDK does not allocate or check
addresses set this way.

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
