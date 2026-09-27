# Physical hardware verification

Use this procedure to record evidence for a particular SDK, ROM, MIA firmware,
video client, and board revision. Emulator tests are separate; see
[emulator automation](emulator-automation.md) and the
[runtime demo](../examples/runtime-demo/).

## Prepare the SD card

From this repository, with the ca65 toolchain installed:

```sh
npm ci
npm test
node packages/cli/bin/clementina.mjs build examples/runtime-demo
node packages/cli/bin/clementina.mjs build examples/hardware-audio
```

Copy the **contents** of `examples/runtime-demo/build/sd` to a card directory
for the runtime test. On the machine, load `BOOT.BAS` and run it as described in
[program loading](program-loading.md). Record the displayed result and, if a
hardware memory inspection interface is available, `$0700` (last completed
check), `$0701` (runtime error), and `$0702` (completion marker `$A5`). The
checked-in [assembly source](../examples/runtime-demo/src/main.s) defines those
mailbox fields. Keep the built files and their hashes with the report.

For the audio test, copy `examples/hardware-audio/build/audio.bas` to the card.
Load `audio.bas` and run it. The program starts a sustained 440 Hz voice panned
left. Press `R` for an 880 Hz voice panned right, `L` to return to the left
voice, and `Q` to release it. The frequencies, voice count, and pan range come
from [the audio spec](../specs/audio.json) and the ROM's BASIC audio contract.

## Capture audio

Follow the board's documented audio output and measurement setup. Capture the
left, right, and released states as separate stereo, 16-bit PCM WAV files after
the board's audio output stage. Record the instrument, sample rate, connection,
and any filtering or gain applied. The SDK supplies measurements with:

```sh
node scripts/analyze-audio-capture.mjs left.wav
node scripts/analyze-audio-capture.mjs right.wav
node scripts/analyze-audio-capture.mjs quiet.wav
```

The analyzer reports each channel's RMS level, peak level, and positive
zero-crossing frequency. It does not assign pass or fail: noise, clipping,
filtering, and board revision affect the measurement. Compare the capture with
the expected tone and pan state and record the observed values and rationale.

## Record the result

For each run, retain:

- date, operator, board revision, and measurement setup;
- SDK, ROM, MIA firmware, emulator, and video-client commit IDs where used;
- SHA-256 hashes of the built SD files and each raw capture;
- runtime-demo screen or memory evidence, with observed mailbox values;
- left, right, and released WAV captures and analyzer JSON output;
- pass, fail, or not observed for each check, with any deviation explained.

Keep results outside `specs/`: a hardware measurement is evidence for a
particular board and software revision, while the specs define the contract.
Do not mark physical verification complete from an emulator snapshot or an
unreviewed analyzer result.
