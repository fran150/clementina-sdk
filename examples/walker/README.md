# Walker

A small program that is all assembly and uses the asset build and the
Clementina library: a level, a player that walks, background music and a
jump sound. The chapters "The asset build" and "The Clementina library" of
the SDK & Studio Guide walk through it.

- Left and right walk (A and D, the arrow keys or a gamepad's d-pad).
- Space, Z or the gamepad's A button plays the jump sound on voice 3.
- Q stops the music.

The assets were made in Clementina Studio: three palettes in one palette
config (sky, ground, player), one tileset, the level background, the
player's shape and its idle animation, two instruments, the song and the
sound effect. `build.assets` in `clementina.yaml` names four slots in MIA
RAM and the files that go on the card; `src/main.s` loads them with the
library and plays.

From this folder:

```sh
clementina build
clementina-emulator --sd build/sd
```

Then type `RUN "BOOT.BAS"` in the video client. To change the art, the music
or the sound, open `clementina.yaml` in Studio with File ▸ Open Project…,
save, and build again.
