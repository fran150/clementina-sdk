# Agent instructions

The SDK is the authoritative developer-facing Clementina contract.

Before hardware-dependent work:

1. Read `docs/compatibility.md`.
2. Read the relevant `docs/architecture/*.md`.
3. Read the corresponding `specs/*.json`.
4. Never invent addresses, limits, commands, formats, or timing.
5. Do not silently choose behavior listed as unresolved.
6. Prefer deterministic SDK validators/build tools when they exist.
7. Keep hardware facts separate from game-development recommendations.

For project and asset work:

- use `clementina.yaml` as the portable project manifest;
- write portable asset files matching `specs/schema/`;
- do not make `.cstudio` the only source of project assets;
- keep Studio session-only state out of portable asset files;
- validate cross-asset references after edits.

For graphics:

- inspect at native 320×200;
- one hardware sprite is 8×8;
- larger characters are shapes made from multiple sprites;
- preserve one tileset across a normal animation;
- use a consistent origin/anchor;
- generate related animation poses coherently rather than independently.
