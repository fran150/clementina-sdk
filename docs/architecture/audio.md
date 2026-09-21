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

Audio indexes are `$E6-$EB`; direct sequencer-status indexes are `$EC-$EF`.
The 32 video direct-OAM descriptors remain contiguous at `$C0-$DF`.

## Background sequencer

Each voice has a compact event stream played by MIA inside the audio engine.
Durations are 24-bit little-endian 24 kHz sample counts, resolved before playback.
The public event-stream contract is documented in the MIA repository.

The current track-buffer region is `$13000-$13FFF`. See `docs/compatibility.md`
for the current overlap with SD/FS state.
