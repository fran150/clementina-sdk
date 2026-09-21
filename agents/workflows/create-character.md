# Create character workflow

1. Read `docs/compatibility.md`, `specs/video.json`, and `specs/assets.json`.
2. Choose the character's footprint in 8×8 hardware sprites.
3. Choose one tileset/bpp and a palette config for preview.
4. Create and approve one canonical idle pose at native 320×200 resolution.
5. Lock silhouette, origin, palette intent, and tile allocation.
6. Generate each animation as a coherent pose set from the canonical pose.
7. Encode each pose as a portable `clementina-shape` asset.
8. Normalize every shape around the same origin, normally bottom-center/feet.
9. Encode the sequence as a portable `clementina-animation` asset using 60 Hz ticks and optional frame offsets.
10. Validate the complete asset set, including same-tileset and shape-reference rules.
11. Open/preview the portable assets in Studio once Studio SDK integration is available.
12. When emulator automation exists, run and capture the animation in-engine.
