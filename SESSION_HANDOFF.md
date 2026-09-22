# Clementina SDK session handoff — 2026-09-21

## Scope and user preferences

Continue **SDK roadmap work** in `/Users/fran150/development/clementina/clementina-sdk`.
Studio UI work is tracked independently in `../clementina-studio/SESSION_HANDOFF.md`.
This handoff is sufficient to resume SDK work; do not take over Studio UI development.

**Do not commit or push unless explicitly asked.** This supersedes the original
request to commit/push completed roadmap phases. Preserve existing local changes in
all repositories. Check git status before editing, particularly in sibling repos.

## Repository state and completed work

SDK main is at `a71acdc` (previously pushed). The working tree was clean before this
uncommitted handoff was added. No SDK implementation changes are pending.

- Phases 0–2: scaffold, canonical machine specification baseline, portable project
  and asset-format baseline.
- `434100e`: Phase 3 baseline: schema-backed structured diagnostics with throwing
  compatibility APIs, Node filesystem project loading/saving, path/ID resolution,
  cross-asset checks, generated schema freshness, bidirectional schema/type
  conformance, migration policy, golden fixtures.
- `6b87627`: initial Phase 4 CLI validation and versioned JSON diagnostics.
- `a71acdc`: CLI wrapper available before the first build.

These commits predate the user's instruction to stop committing.

## Read first

- `AGENTS.md`, `README.md`, `ROADMAP.md`, `IMPLEMENTATION_STATUS.md`
- `docs/shared-packages.md`: APIs, migration and filesystem limitations
- `docs/cli.md`: commands and exit codes
- `docs/compatibility.md`, `specs/known-issues.json`
- Relevant `docs/architecture/*.md`, `specs/*.json`, schemas and package tests

Source repositories are authoritative; do not rely on this snapshot for hardware
addresses, commands, timing, limits or unresolved behavior.

## Shipped surfaces

- `@clementina/core`: diagnostics, validation results/errors, generated schemas.
- `@clementina/assets`: portable asset types, schema/local semantic validation,
  cross-asset reference validation, attribute encoders.
- `@clementina/project`: browser-compatible manifest/project APIs, resolver, Studio
  v2 conversion; Node filesystem APIs are a separate `@clementina/project/node`
  entry point. Paths pair with assets by manifest array order. IDs are scoped by kind.
- CLI: `project validate [directory]`, `asset validate <file>`,
  `sprite validate <file>` (portable shape), `animation validate <file>`, `doctor`.
  `--json` emits structured output; exit codes 0 success, 1 validation/I/O, 2 usage.
  Standalone validation cannot check external references. `doctor` only checks the
  SDK runtime, not emulator/toolchain capabilities. Build/run are not implemented.

Portable format version 1 only; unknown versions are rejected. Package and format
versions are independent. Saving is atomic per file, not a multi-file transaction;
source files belong to the caller. Symlinks inside projects are rejected. See the
API docs for the full limitations instead of inferring guarantees.

## Next SDK work

Resume with Phase 5 emulator automation, after inspecting upstream state. Build/run
CLI commands depend on reusable adapters; do not add fake success stubs. Phase 3's
initial Studio adoption is not full Phase 6 integration.

Prior emulator inspection (no implementation added):
- `../clementina-6502` is Go. Existing CPU cycle stepping, side-effect-free mapped
  memory peeks, register getters and MIA debug text-input hooks are useful.
- Useful source areas: `pkg/computers/clementina`, `pkg/core/emulation`,
  `pkg/components/mia`, and headless ROM/editor tests.
- Automation must serialize machine access; the UI pause flag alone does not
  establish a safe inspection boundary. Do not bolt concurrent reads onto it.
- Framebuffer rendering is in `../clementina-video-client/internal/render`.
  Reuse that behavior rather than inventing another compositor.
- Keep emulator implementation in Go; implement the SDK client separately in
  `@clementina/emulator-client`. Inspect all capabilities before defining protocol.

Later roadmap: finish Studio contracts; ca65/ld65 assembly integration from the ROM;
BASIC tooling based on actual ROM tokenizer and SAVE/LOAD behavior; agent workflows;
MCP over shared APIs; thin VS Code integration once APIs are stable. Phases 5–11
have not been implemented. Do not assume BASIC uses a generic PRG output format.

## Cross-repository coordination

All repositories live under `/Users/fran150/development/clementina`:
`clementina-sdk`, `clementina-studio`, `clementina-rom`, `clementina-mia`,
`clementina-6502`, `clementina-video-client`.

Studio main was `f29e046`; it has **uncommitted animation UI changes** being developed
separately. Do not overwrite, reset, stage or commit them. Its handoff lists details.
Studio consumes local SDK links and shared types/converters, but still owns legacy
validators and `.cstudio` persistence. Portable project UI open/save is not connected.
Legacy Studio inputs are broader than portable schemas: validator migration needs
explicit normalization/parity tests. Preserve behavior when evolving SDK APIs.
Coordinate new scene/music asset contracts with the Studio session.

## Verification already completed

SDK's last implementation checks passed: **17 tests**, schema generation freshness,
schema/TypeScript conformance and all workspace typechecks. Those checks were run
when the SDK commits were completed; do not describe them as newly run this session.
Studio's subsequent animation changes also passed its 40 model tests and three
Electron suites; see its own handoff if cross-repository changes require rerunning.

From SDK:

```sh
npm ci
npm test
npm run typecheck
npx clementina project validate examples/minimal-game --json
```

After schema edits: `npm run generate:schemas`, then tests. Build the SDK before
building Studio with its local links. Repeat checks when changes justify them.

## Guardrails

SDK is the authoritative, language-neutral developer contract. Specs/core must not
depend on Studio, emulator UI, MCP or AI integrations. CLI and MCP call reusable
APIs rather than duplicating logic; emulator client does not depend on Studio.
Use generated constants/spec files for cross-language consumers where appropriate.

Use `clementina.yaml` and portable assets matching `specs/schema`; keep session-only
state out of portable assets. Validate cross-asset references after changes.
One sprite is 8×8, larger characters are shapes, related animation poses preserve
one tileset and consistent anchors; verify current source before hardware changes.
The audio-sequencer/SD MIA-RAM overlap remains unresolved in compatibility docs.
No runtime packing or memory placement has been implemented. Recheck upstream before
allocation/linking work and record genuine contradictions instead of guessing.

## Resume

Read the listed docs, inspect current git/upstream state and begin the next SDK task
with reusable APIs and meaningful tests. Keep Studio UI work separate. Leave all
changes uncommitted and unpushed unless the user explicitly requests otherwise.

## Update — Phase 5 headless baseline implemented (2026-09-21)

This update supersedes the earlier “no implementation added” Phase 5 snapshot.
All work remains uncommitted. The pre-existing handoff content above is preserved.

- SDK: `@clementina/emulator-client` now has a transport-independent client and HTTP
  adapter with request/reply validation, plus `specs/emulator-automation.json` and
  `docs/emulator-automation.md`.
- Emulator: new `pkg/computers/clementina/automation.go` owns a headless machine;
  a mutex serializes reset, bounded cycle stepping, register/mapped-memory reads,
  raw text-byte input, snapshots, and cleanup. `cmd/clementina-automation` exposes
  loopback HTTP with an ephemeral port by default. No terminal or UDP loop shares
  the machine. Existing MIA pause callbacks stop bounded execution.
- Video client: public `pkg/render.Snapshot` wraps the existing compositor;
  `cmd/clementina-render` converts a JSON video-byte array to native 320×200 PNG.
- No Studio files or existing shared asset/project contracts were changed. All
  sibling repositories reported clean status before work began.
- Verified: 20 SDK tests, schema/spec checks and all workspace typechecks; Go
  automation tests under `-race`; existing compositor and new facade tests; real
  Go → SDK → Go-renderer integration booting BASIC and verifying `POKE 752,42`.
  Run commands are in the automation document. Integration binaries were built
  into `/tmp`, not committed artifacts.

Pending: continuous run/pause, instruction stepping, breakpoints, program loading,
held HID/gamepad input, lifecycle client APIs, and CLI integration. VS Code remains
an eventual consumer of these reusable APIs, not the owner of debugging behavior.
Host wall time is unchanged; this baseline is not deterministic replay. Reset is
an upstream-style reset pulse, not cold recreation. Memory holes are `null` and
reserved-high MIA mirroring remains explicitly emulator-only behavior. The known
audio/SD overlap has not been resolved or allocated around.

## Update — execution control and breakpoints (2026-09-21)

Implemented the next Phase 5 increment, still without commits:

- Go session: serialized unthrottled background runner, synchronous pause,
  MIA-aware resume, bounded instruction stepping, address breakpoint management,
  coherent execution state and stop reasons, joined concurrent-safe cleanup.
- CPU debug boundary inspection accounts for skipped conditional branch cycles;
  pure cycle predicates support lookahead without executing bus operations.
  CPU execution behavior is unchanged. Breakpoints stop before opcode fetch.
- SDK: run/pause/resume, stepInstruction, add/remove/list/clear breakpoints,
  validated execution-state responses. Older v1 state replies remain accepted;
  callers can discover new methods through capabilities.
- Protocol, docs and integration script updated. The Go tests exercise breakpoint
  side effects, repeated hits/resume, mid-instruction stepping, taken/untaken
  branches, operand-address exclusion, WAI cycle budgets, STP, real MIA pause,
  stable pause snapshots, and concurrent close.
- Verification: 21 SDK tests and workspace typechecks passed; full automation race
  tests and CPU/MIA/manager regressions passed. Additional branch-boundary checks
  were added after the first race run and verified separately.

Program loading and CLI/debug-symbol adapters are next. No Studio UI files were
changed. Studio now has separate uncommitted work; preserve it. The documented
WAI/RDY/VCC board-wiring caveat is not fixed by this work (see automation docs).
The audio/SD overlap remains unresolved. Do not commit without asking the user.

## Update — BASIC bootstrap program loading (2026-09-21)

Documented the BASIC bootstrap as the common runtime entry for assembly/mixed
projects and implemented the reusable program-loading layer, still uncommitted:

- `specs/schema/load-plan.schema.json` defines ordered MIA and PRG steps with one
  terminal takeover step. It is included in generated schemas and bidirectional
  TypeScript conformance checks.
- `@clementina/basic` now validates load plans, generates ROM-compatible numbered
  BASIC source, packs exact two/three-byte PRG headers, and inspects PRGs. It does
  not implement a separate tokenizer.
- Returning CPU images are banked. The final image uses `BLOAD`'s run argument;
  portable plans do not generate `BLOAD` then `SYS` for takeover programs.
- MIA loads validate against 256 KiB. Any step touching `$13000-$13FFF` must name
  `audio-sequencer-sd-memory-overlap` in `acknowledgedIssues`; acknowledgement
  records intent and does not resolve the upstream conflict.
- The Go automation command accepts `-sd <existing-directory>`. The emulator
  client `launchLoadPlan` boots, enters generated source through the real ROM
  editor/tokenizer, then starts `RUN`, preserving debugger breakpoints.
- `docs/program-loading.md` is the complete contract. Roadmap/status/shared-package
  and emulator docs are synchronized.
- Verification passed: 25 SDK tests, all workspace typechecks, generated schema
  freshness/conformance, Go automation tests under `-race`, and a real integration
  flow that mounts generated PRG/MIA files, runs the BASIC bootstrap, stops at
  `$6005`, verifies CPU/MIA effects, and renders the snapshot.

Next implementation layer: ca65/ld65 and portable-asset output adapters that
produce and verify load-plan files, followed by CLI build/run and debug-symbol
mapping. Preserve Studio's unrelated uncommitted work. Do not commit without asking.
