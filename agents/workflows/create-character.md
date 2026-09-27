# Create and verify a character

One hardware sprite is 8×8; a character is a shape made from sprites. Use one
tileset for every pose in an animation and preserve one origin and canvas.
Read `docs/compatibility.md`, `docs/architecture/video.md`,
`specs/video.json`, and `specs/assets.json` before editing.

1. Make a canonical idle pose and inspect it at native 320×200. Lock its
   silhouette, palette intent, tile allocation, and origin.
2. Make related poses coherently in the same tileset. Store each pose as a
   portable `clementina-shape` JSON file and sequence them with a portable
   `clementina-animation` JSON file. Use frame offsets/flips for movement
   rather than drifting the anchor. Add the files to `clementina.yaml`.
3. Run `node packages/cli/bin/clementina.mjs project validate <project>`.
   This checks cross-asset references and the same-tileset rule.
4. Render the character from the game under the emulator. Use the
   [debug workflow](debug-game.md) to stop immediately after the drawing call
   and save `debug.video.bin`.
5. Add `checks/character.json` (outside the portable asset manifest):

```json
{
  "format": "clementina-character-check",
  "version": 1,
  "animationId": "animation:Player_Idle",
  "frameIndex": 0,
  "oamStart": 0,
  "originX": 40,
  "originY": 40,
  "videoPath": "build/inspection/debug.video.bin"
}
```

6. Run:

```sh
node agents/workflows/create-character.mjs <project> --renderer /path/to/clementina-render
```

The check loads the portable project through the SDK, verifies a common
origin/canvas, then compares the frame's expected tile, position, palette and
flips with emulator OAM records. It writes
`<outputDirectory>/inspection/character-report.json` and a native 320×200
`character.png`. Open the PNG at native size to judge silhouette, palette,
and motion; OAM checks alone cannot establish visual quality. Repeat for
each important frame by changing `frameIndex` and capturing that frame.

`examples/runtime-demo/checks/character.json` is a working reference after
stopping the demo at its first `Check 30` line.
