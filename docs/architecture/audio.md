# Audio architecture

MIA provides a four-voice stereo PWM PSG at 24 kHz.

- frequency: unsigned 12.4 fixed-point Hz
- waveforms: sine, pulse, saw, triangle, noise
- pan: -64..63
- per-voice volume: 0..255
- master volume: 0..15
- live audio state: `$12000-$1204F`
- voice records: 16 bytes

Commands:

- `$60` enable
- `$61` stop
- `$62` reset
- `$63` sequencer load
- `$64` sequencer start
- `$65` sequencer stop
- `$66` voice take
- `$67` voice release
- `$68`-`$6B` sequencer set base, voice 0-3 (24-bit little-endian address)

Audio indexes are `$E6-$EB`; direct sequencer-status indexes are `$EC-$EF`.
The 32 video direct-OAM descriptors remain contiguous at `$C0-$DF`.

## Background sequencer

Each voice has a compact event stream played by MIA inside the audio engine.
Durations are 24-bit little-endian 24 kHz sample counts, resolved before playback.
The public event-stream contract, including the full opcode table, is documented
in the MIA repository (`docs/audio-sequencer.md`); `specs/audio.json`'s
`sequencer` block mirrors it for tooling.

A track has no declared length and no header: it is opcode bytes at a
per-voice `track_base`, decoded live until an `END`, an unrecognized opcode,
or a cursor past the top of MIA RAM. There is no per-track size limit.
A voice has no track until `AUDIO_SEQ_SET_BASE0-3` (`$68`-`$6B`) sets its
`track_base`, which can be anywhere in MIA RAM. Boot and `AUDIO_RESET` forget
every base and clear no MIA RAM, and `AUDIO_SEQ_START` leaves a voice without a
base stopped. The caller is responsible for avoiding the video sync region,
input/clock state, the audio register block, SD/FS state
(`$13000-$13BFF`, see `docs/architecture/storage.md`), and other voices'
tracks — the SDK does not allocate or check this beyond rejecting a load-plan
MIA step that overlaps SD/FS state (see `docs/compatibility.md`). Looping is
expressed with a self-relative `JUMP` opcode rather than a header `LOOP`
field, so a track's internal jumps are invariant under relocation.

Per-voice `SEQ_NOTE_INDEX` (offsets `$09-$0A` of the 16-byte voice record) and
`SEQ_STATUS` (offset `$0B`) back the BASIC `CUE`/`PLAYING` functions and are
also exposed directly through indexes `$EC-$EF`.
