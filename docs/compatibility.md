# Current compatibility notes

## Audio sequencer and SD/FS MIA RAM (resolved)

Audio sequencer track buffers used to default into `$13000-$13FFF`, overlapping
SD/FS state at `$13000-$13BFF`. Current MIA firmware and emulator code have
resolved this: sequencer tracks are relocatable (`AUDIO_SEQ_SET_BASE0-3`,
commands `$68-$6B`), have no per-track size cap, and default to
`$14000`/`$15000`/`$16000`/`$17000` (voices 0-3), outside SD/FS's region. See
`docs/architecture/audio.md` and `specs/known-issues.json` (status `resolved`)
for the full contract and reconciliation record.

SD/FS's own `$13000-$13BFF` region remains permanently reserved for its
control/sector/path/dir/transfer state, independent of audio. `@clementina/basic`'s
load-plan validation rejects any MIA load step that overlaps it; this is a hard
bounds failure, not an acknowledgeable trade-off, since nothing else has a
legitimate default claim on that range. A caller relocating a sequencer track with
an explicit `AUDIO_SEQ_SET_BASE` address is responsible for avoiding SD/FS state
and other reserved regions themselves — the SDK does not allocate or check
addresses set this way.
