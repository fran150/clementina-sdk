# Source audit

Phase 1 was derived from the five repositories and exact commits recorded in
`specs/source-manifest.json`.

## Authority by concern

| Concern | Primary source |
| --- | --- |
| CPU address decode | `clementina-6502` |
| Physical MIA behavior | `clementina-mia` |
| Kernel ABI / current ROM memory use | `clementina-rom` |
| Video state/protocol | `clementina-mia` |
| Host rendering/client behavior | `clementina-video-client` |
| BASIC programming surface | `clementina-rom` |
| Asset authoring model | `clementina-studio` |

## Audited project documentation

### clementina-rom
`README.md`, memory map, BASIC video/input/memory/sound/timing/file docs,
charset/keyboard and styled-string design docs, BASIC import notes, and WozMon notes.

### clementina-mia
`README.md`, all audio/input/SD/video subsystem docs and programmer guides,
input/video UDP protocol docs, video implementation plan, and video PoC notes.

### clementina-6502
`README.md`, GPIO pin map, and emulator performance notes. Generic historical
Ben-Eater portions of the README are not treated as current Clementina hardware spec.

### clementina-video-client
`README.md`.

### clementina-studio
`README.md`, `docs/model.md`, and `docs/animations.md`.

When repositories disagree, the mismatch is recorded instead of silently choosing
a value.
