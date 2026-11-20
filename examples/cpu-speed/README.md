# CPU speed

A BASIC program that counts how many times a one-line loop runs in one
second, measured with MIA's millisecond clock (`TICKS`). Press a key to
start each count.

`clementina.yaml` sets `target.phi2Hz` to 4,000,000, so the bootstrap sets
the 6502's clock to 4 MHz before it loads the program. Remove the line, or
set it to 1200000, and build again to compare with the board's 1.2 MHz.

The count comes from MIA's clock, so it measures real time at any speed.
A loop that counted passes instead would run faster at 4 MHz and finish
sooner.

From this folder:

```sh
clementina build
clementina-emulator --sd build/sd
```

Then type `RUN "BOOT.BAS"` in the video client. `clementina check` runs the
program headless, without real-time pacing, so its count says nothing about
the speed; it tests that a key starts the count. The count's own end
depends on real time, so the check doesn't wait for it.
