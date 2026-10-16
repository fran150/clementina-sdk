# Sources

The developer specification was first derived from a 2026-09-20 audit of five repositories (below).
Since then `npm run check:drift` checks it against the two repositories most of its values come
from: it reads MIA's C headers and a fresh cc65 build of the ROM (`kernel.dbg`, `kernel.lbl`,
`kernel.bin`) and compares names and values, not descriptions, with `specs/`. It expects
`clementina-mia` and `clementina-rom` checked out next to the SDK (or `--mia DIR --rom DIR`) and
cc65 on the path.

`specs/source-manifest.json` records the MIA and ROM commits the check last found matching; only
`npm run check:drift -- --record` writes them, and only when nothing differs. The `Spec drift`
workflow runs the check against both repositories' `main` every Monday and on demand from the
Actions tab. It reports and never blocks a pull request: a red run means a spec and its source
disagree, and the fix goes in a normal PR together with a fresh `--record`.

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

## Audited project documentation (2026-09-20)

### clementina-rom
`README.md`, memory map, BASIC video/input/memory/sound/timing/file docs,
charset/keyboard and styled-string design docs, BASIC import notes, and WozMon notes.
The BASIC tokenizer additionally follows `src/basic/token.s`, `program.s`,
`misc1.s`, `inline.s`, `defines_clementina.s`, and the program `LOAD`/`SAVE`
implementation in `clementina_extra.s`.

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
