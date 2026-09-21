# AI-assisted character/sprite workflow

One Clementina hardware sprite is 8×8. Larger actors are shapes made from several sprites.

1. Choose shape footprint in 8×8 tiles.
2. Choose one tileset/bpp and a preview palette config.
3. Create one canonical idle shape.
4. Judge it at native 320×200 resolution.
5. Lock silhouette, palette intent, origin, and tile allocation.
6. Generate each animation as one coherent pose set from the approved reference.
7. Convert poses into shapes using the same tileset.
8. Preserve one logical anchor, normally bottom-center/feet.
9. Use frame offsets for small body bobbing instead of duplicating identical shapes.
10. Validate and preview at real 60 Hz tick durations.

This avoids the scale/palette/anchor drift common to independent frame generation.
