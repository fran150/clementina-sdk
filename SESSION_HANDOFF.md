# Clementina SDK session handoff — 2026-09-26

## 2026-09-26: Phase 6 Studio validator migration

Studio's session project and graphical validators now delegate to
`@clementina/project`; its browser audio validators delegate to
`@clementina/assets/audio`. The SDK's Studio v2 compatibility validator
preserves legacy identity, optional binding, canvas, and session-state behavior.
`checkStudioProjectV2` returns a copy with absent collections filled in without
editing the source. Portable export still uses the stricter versioned schemas.

SDK `npm test` and Studio `npm test` pass, as do Studio's audio and Builder
Electron UI checks. Existing uncommitted work in both repositories was retained;
no commit or push.

## 2026-09-26: Portable project round trip with Studio

Studio now opens `clementina.yaml` through File > Open and opens existing
assembly folders through Builder. The SDK's Studio conversion preserves imported
animation IDs; Builder preserves existing manifest asset paths by ID. File > Save
writes portable assets back to their original folder, retaining the manifest's
program/build declarations and source files. Missing assets still require an
explicit removal confirmation. New and duplicated animations receive stable IDs.

Verified: SDK `npm test` (101/101), Studio `npm test` (64/64), Studio Electron UI
suite, and a focused Electron open/edit/save round-trip test. No commit or push.

## 2026-09-26: Builder work (read this first)

The asset builder and runtime from `docs/gamedev/builder.md` are built and
tested, in the SDK and in Studio's Builder tab. Nothing is committed, and the
user said not to commit until asked. The older sections below predate this
work. This work spans the SDK and Studio: the older "do not take over Studio
UI development" scope does not apply to Studio's Builder tab, which is part
of it.

**Done and verified** (all of builder.md's "Implementation order"):
- Portable instrument, sound and song assets, the file encoders
  (`packages/assets/src/runtime-files.ts`) and the song and sound compiler
  (`@clementina/assets/audio`, which Studio also uses).
- The `build.assets` manifest section with slot and include checks;
  `packages/build/src/assets.ts` (planAssetBuild, assets.inc, assets.s, the
  memory report); `buildProject` writing `<out>/sd` with `BOOT.BAS`, building
  `runtime.lib` with ca65 and ar65, and returning `sdRoot`.
- CLI `run` and `packages/debug/src/node.ts` mount `resolve(root, sdRoot)`.
- `packages/runtime` (`@clementina/runtime`): 17 ca65 modules.
- Tests: `tests/builder.test.mjs` covers manifest checks, planning, labels,
  collisions, the generated text, the report, the descriptor and state
  constants against `runtime.inc`, and a real-toolchain build (skipped
  without cc65).
- `examples/runtime-demo` calls every public routine and records checkpoints
  at `$0700`. `scripts/test-runtime-integration.mjs <automation> <renderer>`
  extends it with an 80 KB background, a relocation across banks and
  placeholder 128, then checks memory, video registers, CHR and background
  bytes, sprite and animation OAM transitions, scroll, viewport, song and sound
  state, and renders a PNG.
- Emulator automation now exposes `audio`: an 80-byte audio register snapshot
  whose note-index and sequencer-status bytes come from live engine state.
  `@clementina/emulator-client` validates the response. The emulator also
  serves those live fields through general indexes, matching the Pico's RAM
  reads and the runtime's `SongPosition` routine.
- Docs: builder.md (status, resolved details, additions and renames, `kind`
  in the manifest sketch), project-format.md, cli.md, program-loading.md.

**Results on 2026-09-26:** SDK `npm test` 102/102; the runtime integration
script reaches checkpoint 55 with video and audio assertions passing; focused
Go automation/audio tests pass under `-race`; `test-emulator-integration.mjs`
also passes with the rebuilt emulator. Build the binaries as
`docs/emulator-automation.md` says
(`go build` in clementina-6502 `./cmd/clementina-automation` and
clementina-video-client `./cmd/clementina-render`).

**Not verified:**
- The runtime has run only in the Go emulator, never on the Pico firmware.
- Audio output waveform and hardware behavior are not verified by the register
  snapshots; the emulator's audio sample timing uses host wall-clock time.
- Studio's Builder writes only the assets Studio holds. Saving into an SDK
  project that lists others asks first (Cancel by default). Studio can now open
  a portable project's assets before editing and saving them.

**Studio side:** see the matching section of
`../clementina-studio/SESSION_HANDOFF.md`.

## Working context carried over from the previous agent (2026-09-26)

This context lived in the previous agent's private memory, so it is written
out here. Studio-specific conventions are in the same kind of section in
`../clementina-studio/SESSION_HANDOFF.md`.

**The user.** fran150 designed the whole stack and builds it end to end:
- the Clementina 6502 machine;
- the MIA video/audio chip (Pico firmware and a Go emulator);
- the kernel and BASIC ROM, in assembly;
- the SDK;
- Clementina Studio, an Electron authoring app.

They know the hardware deeply and will correct a model that doesn't match
the silicon. On design trade-offs:
- They ask for one recommendation backed by the hardware source, not a menu
  of options. When unsure, re-read the source before answering.
- Name real constraints (a 4-bit attribute field, a 16-bit DMA length)
  rather than inventing conventions as limits.
- They treat inconsistency between editors, and behavior unlike well-known
  editors (Figma, Aseprite, Tiled), as usability bugs.

**Standing instructions:**
- Don't commit or push until asked.
- Preserve other sessions' uncommitted work.
- Never print, copy or mention the values in `clementina-mia/setup-env.sh`
  (Wi-Fi credentials).
- Don't edit `.claude/settings.local.json`.

**Where hardware truth lives** (read before modeling a hardware resource, and
say which file an answer came from):
- `../clementina-video-client/internal/render/renderer.go`: pixel truth.
  Attribute bits, palette indexing, which layers make color 0 transparent,
  and OAM decoding.
- `../clementina-6502/pkg/components/mia/*.go`: the emulated memory map,
  indexes, commands, SD, audio and sequencer.
- `../clementina-mia/src/mia/`: the real firmware (`video/`, `audio/audio.c`,
  `sd/sd.c`, `cmds/cmds.c`, `mem/dma.c`, `sys/mia.c`). Its `docs/` sometimes
  lag the code.
- `../clementina-rom/src/kernel/`: kernel conventions layered on the
  hardware (`kernel.inc` names, `memory.s` services). Tell convention from
  silicon: the console's palette 0 for text is a convention, not a reserved
  slot.
- `../clementina-rom/docs/`: the BASIC layer, including `memory-map.md`.

**Why the Builder design has its shape.** The user rejected earlier proposals
that had:
- per-level layouts;
- a runtime-owned update loop;
- memory regions locked for the system;
- fixed 40x25 background pages.

The split they set: Studio supplies assets in loadable form and primitives
(TickAnimation and the like), and the game's programmer decides when anything
loads, ticks or composes. Reject Builder features that decide load timing or
sequencing. The Studio Builder tab only edits the `build.assets` settings,
runs the SDK build and runs the emulator.

**Open audio findings** (reported to the user in an earlier session, not acted
on; check whether they are still open):
1. MIA's sequencer doc says NOTE holds `dur` samples, but the ISR holds
   `dur + 1`. The SDK compiler writes samples - 1 to match the ISR.
2. The ROM's `TRACK` never gates off between notes, so a sustain-0
   instrument sounds only the first note of a run.
3. There is no zero-duration SET_FREQ opcode for smooth sequenced pitch
   moves.

If the firmware changes any of this:
- revisit `compileSong` in `packages/assets/src/audio.ts` (it writes
  samples - 1, and a one-sample REST to retrigger);
- run Studio's `npm run test:firmware` and update the hashes in Studio's
  `tests/audio.test.mjs`.

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

## Update — initial assembly and asset output adapters (2026-09-21)

- `@clementina/assembler` now performs ordered multi-source ca65/ld65 builds,
  writes binary/PRG/listing/map/label/debug artifacts, verifies linked segments
  against the declared PRG load address, resolves the terminal entry symbol, and
  parses ld65 v2 debug records for source mapping.
- Palette, palette-configuration, and tileset encoders emit the documented MIA
  RGB565 and planar CHR bytes. Callers must select CHR banks explicitly.
- No addresses are allocated automatically. Shape and animation runtime output is
  deferred because no binary ABI exists for it.
- Next: add explicit project build/placement declarations and a reusable project
  artifact composer, then expose it through CLI `build` and `run`.
- Verification: 29 SDK tests and all workspace typechecks pass, including a real
  two-source ca65/ld65 build when those tools are installed.

## Update — portable project build composition (2026-09-21)

- `clementina.yaml` can now declare explicit assembler/linker settings, output
  directory, palette configuration, and CHR bank assignments.
- `@clementina/build` validates the whole project, calls the assembler adapter,
  emits selected palette/CHR binaries, then writes `load-plan.json` and the BASIC
  bootstrap. It does not infer addresses or emit shapes/animations.
- CLI `build [directory]` calls the shared composer and provides artifact paths in
  versioned JSON output. CLI `run` remains pending a process lifecycle API that can
  guarantee the emulator mounts the same project root as SD storage.
- Verification passed with 31 SDK tests, schema/spec freshness, and all workspace
  typechecks. Project composition is tested with deterministic tool output; the
  assembler suite separately uses real ca65/ld65 when installed.
- Next: emulator lifecycle/spawn support and CLI `run`, followed by translating
  ld65 source records into source breakpoint APIs.

## Update — emulator lifecycle and CLI run (2026-09-21)

- `@clementina/emulator-client/node` starts the Go automation executable without a
  shell, mounts an existing SD root, validates its loopback `/v1` endpoint and
  capabilities, reports startup stderr, and owns idempotent termination.
- CLI `run [directory]` builds through `@clementina/build`, mounts the project root,
  launches the generated load plan through the ROM, reports the debugger endpoint,
  and remains attached until SIGINT/SIGTERM. Executable and port are host-only CLI
  settings rather than portable manifest fields.
- The cross-repository integration script now uses the public lifecycle adapter.
- Verification passed with 34 SDK tests, all workspace typechecks/spec checks, and
  the real Go emulator → BASIC bootstrap → debugger/render integration.
- Next: complete ld65 span parsing and source-line/address mapping, then expose
  source breakpoints over the existing address-breakpoint client API.

## Update — source mapping and source breakpoints (2026-09-21)

- `@clementina/assembler` now parses ld65 v2 span records and multi-span line
  references. `createAssemblySourceMap` resolves exact source lines to emitted
  spans, addresses back to every containing source span, and executable line lists.
- The build request supplies Clementina bank metadata because ld65's v2 debug file
  does not encode it. Banked source locations retain that metadata.
- `@clementina/emulator-client` accepts the source map structurally and adds or
  removes one existing logical address breakpoint per emitted span start. Blank or
  non-emitting lines fail explicitly instead of moving to another line.
- The Go protocol and sibling repositories were not changed. Banked source
  breakpoints remain logical-address comparisons and may also fire in another bank
  mapped at the same `$8000-$BFFF` address.
- Full verification passes: generated schema freshness, spec validation, every
  workspace build/typecheck, and all 36 SDK tests, including a real two-source
  ca65/ld65 mapping check when the installed toolchain is available.
- Next: source-line stepping and step-over semantics, then thin editor/VS Code
  adapters. Do not commit without explicit user instruction.

## Update — source stepping and JSR step-over (2026-09-21)

- `EmulatorClient.stepSource` executes bounded machine-instruction steps until the
  exact set of ld65 `path:line` locations at PC changes. Unmapped code, MIA pause,
  STP/cycle exhaustion, and the SDK instruction budget are explicit result reasons.
- `stepOverSource` recognizes the actual emulator's `$20` three-byte JSR and waits
  for its return PC and caller stack pointer before applying the same line-change
  rule. Other opcodes use ordinary source-step behavior. Jumps and stack tricks are
  not inferred as calls.
- Both methods require a stopped instruction boundary and use the structural source
  map interface, preserving the browser-compatible emulator client and avoiding an
  assembler package dependency.
- Unit tests cover same-line spans, call/return, unmapped locations, limits, stop
  reasons, and invalid starting states. The real integration program now includes a
  subroutine and verifies source step-over through the Go emulator. Full validation
  passes with 40 SDK tests, every workspace build/typecheck, spec/schema checks, and
  the real Go emulator → BASIC load → debugger/render integration.
- Next: thin editor/debug-adapter integration and held HID/gamepad automation.
  Do not commit without explicit user instruction.

## Update — editor-neutral debugger session (2026-09-21)

- New `@clementina/debug` centralizes one CPU thread/frame, raw register snapshots,
  source breakpoint replacement/ownership, command serialization, execution and
  source-step controls, memory reads, bounded stop polling, and cleanup.
- Source breakpoint synchronization preserves pre-existing external address
  breakpoints and shared addresses. Unresolved lines and logical-only banked
  addresses return explicit editor-facing messages.
- `@clementina/debug/node` builds a portable project, starts the owned Go emulator,
  creates the ld65 source map, and returns a prepared session. Execution remains
  stopped until `launch`, allowing editor breakpoint configuration first.
- The package has no VS Code dependency and is not itself a DAP server. A later
  extension can translate protocol requests into the reusable session API.
- Focused tests cover breakpoint ownership, snapshots/registers, controls, stop
  polling, cleanup, composition ordering, idempotent close, and diagnostics.
- Full repository verification passes with 46 SDK tests, generated schema/spec
  checks, every workspace build, and the editor/debugger composition tests.
- Next: held HID/gamepad automation or an actual thin VS Code/DAP transport. Do not
  commit without explicit user instruction.

## Update — BASIC tokenizer and file output (2026-09-22)

- `specs/basic.json` records the active Clementina ROM token tables, `$FC-$FF`
  prefixes, 0-63999 line-number range, 71-character editor limit, raw program
  record structure, and styled-literal sidecar marker.
- `@clementina/basic` now parses numbered source, tokenizes with the ROM's exact
  search order and lexical modes, compiles raw `SAVE`/`LOAD` files, validates and
  inspects existing files and sidecars, and detokenizes canonical source.
- Default output uses `$FFFF` nonterminal links specifically for ROM `LOAD`, which
  rebuilds them. Exact in-memory images require an explicit `baseAddress`; the SDK
  does not hardcode the ROM-dependent `TXTTAB`.
- CLI `basic compile <source> <file>` calls the shared compiler and writes the
  binary LOAD format. Portable-project build/run composition remains pending.
- The real Go emulator integration loads and runs compiled output, saves it again
  through the ROM, compares SDK tokens with the ROM tokenizer byte for byte, then
  continues through the existing BASIC bootstrap, PRG/MIA, debugger, and renderer
  checks. Full SDK validation passes with 52 tests, generated schema/spec checks,
  and every workspace build/typecheck.
- No sibling repository was modified. Do not commit without explicit user request.

## Update — portable-project BASIC build/run/debug composition, audio sequencer sync (2026-09-22)

Resumed from a prior agent's in-progress edits (uncommitted, not a clean baseline):
it had already implemented most of a `program.kind: basic` build path but left two
latent failures (`@clementina/build` had a TS narrowing error on `config.basic`,
and the new `project.schema.json` `build.anyOf` required-property pattern violated
Ajv strict mode) that made `npm run build`/`npm test` fail. Fixed both, then
verified and extended the feature, and separately synced the SDK with an already-
committed upstream firmware/emulator/ROM change to the audio sequencer.

**Audio sequencer relocation (`clementina-mia` `bf80dbb`, `clementina-6502`
`5febec6`, `clementina-rom` `7044039`, all pre-existing on disk, not made this
session):** sequencer tracks are now relocatable (`AUDIO_SEQ_SET_BASE0-3`,
commands `$68-$6B`), undeclared-length, and default to `$14000/$15000/$16000/
$17000` instead of the old fixed `$13000-$13FFF` layout that aliased SD/FS state.
`specs/known-issues.json`'s `audio-sequencer-sd-memory-overlap` is now `resolved`;
`specs/audio.json`'s `sequencer` block, `docs/architecture/audio.md`, and
`docs/compatibility.md` describe the new opcode stream (`END`/`NOTE`/`REST`/
`SET_WAVE`/`SET_ADSR`/`SET_PAN`/`SET_VOL`/`SET_PULSE`/`JUMP`), decode/catch-up
budgets, and `SEQ_NOTE_INDEX`/`SEQ_STATUS` voice-record offsets. SD/FS's own
`$13000-$13BFF` remains permanently reserved; `@clementina/basic`'s load-plan
validator now rejects any `mia` step overlapping it as a hard bounds failure
(`load.mia.reserved`) rather than an acknowledgeable trade-off — the
`acknowledgedIssues`/`knownLoadIssue` mechanism is removed (schema, types,
docs, tests) since there is no longer a legitimate default conflict to
acknowledge. Every stale "unresolved overlap" reference across `IMPLEMENTATION_
STATUS.md`, `ROADMAP.md`, and `docs/emulator-automation.md` was updated.

**BASIC project build/run/debug (the increment the prior agent described but
didn't finish verifying):** `program.kind: basic` manifests can declare
`build.basic: {outputName}`; `project.schema.json`'s `build` uses `anyOf`
(`assembly` xor `basic`, schema-enforced) plus `validate.ts` cross-checks that
`program.kind` matches which one is present and explicitly rejects `mixed`
composition (not defined yet) and `assembly`+`basic` both present.
`@clementina/build` returns a discriminated `{kind:'assembly',...}` or
`{kind:'basic', basic:{source,artifact,bytes,lines}, ...}` result; the BASIC
branch compiles `program.entry` through `@clementina/basic` and its load plan's
terminal step is the compiled program itself (no bootstrap file). CLI
`build`/`run` and `@clementina/emulator-client`'s `launchLoadPlan` already
branched on this via `checkLoadPlanLaunch`'s existing `numbered`/`direct` launch
modes (a BASIC plan issues preceding MIA/PRG steps as direct commands, then
`LOAD`+`RUN`, instead of a generated numbered bootstrap) — this was already
correct and is now exercised by tests. `@clementina/debug`'s
`createProjectDebugSession` explicitly rejects a non-assembly build
(`debug.program-kind`) before starting an emulator, since its source map is
ld65-only.
- Added: a real `buildProject` test compiling a BASIC project end to end
  (`tests/build.test.mjs`), a `createProjectDebugSession` BASIC-rejection test
  (`tests/debug.test.mjs`), a CLI `build`/`run` BASIC-kind composition test
  (`tests/cli.test.mjs`), and a `basic`-terminal `launchLoadPlan` block (with a
  preceding `mia` step) in `scripts/test-emulator-integration.mjs`, run three
  times against a freshly built real Go `clementina-automation`/`clementina-render`
  (from the already-committed `clementina-6502`/`clementina-video-client` state)
  with no flakiness.
- Updated `docs/cli.md`, `docs/program-loading.md` (new "BASIC terminal step"
  section), `docs/shared-packages.md`, `docs/debugger.md`, `docs/assembly.md`
  context, `README.md`, `ROADMAP.md`, and `IMPLEMENTATION_STATUS.md` to match;
  `docs/cli.md` previously still said "portable-project build composition is a
  later increment" after the feature existed.
- Verified: 54 SDK tests, generated schema/spec freshness, every workspace
  build/typecheck, and the real Go emulator integration (BASIC LOAD/SAVE
  round-trip, generated assembly bootstrap, PRG/MIA load, debugger breakpoints/
  source step-over, the new BASIC load-plan direct launch, and PNG rendering).
- No sibling repository was modified by this session (the firmware/emulator/ROM
  audio-sequencer commits already existed on disk, and `go build` does not write
  to a repository's git state). Nothing in `clementina-sdk` was committed or
  pushed. `clementina-6502`'s branch/commit state changed mid-session outside
  this session's control — it was on `feature/sequencer-relocatable-tracks`
  (HEAD `5febec6`) with uncommitted CPU/MIA changes and untracked automation
  files when the automation binary below was built from it, and is now on
  `main` two commits ahead of `origin/main` (HEAD `fa68b6b`, "headless
  automation server for clementina-sdk"), working tree clean. That commit's
  content matches what was built and integration-tested. This was someone
  else's concurrent activity in that repo, not an action taken here.

Next: a BASIC LSP and `program.kind: mixed` composition rules remain undefined.
Do not commit without explicit user instruction.

## Update — BASIC language navigation and editing (2026-09-22)

- `@clementina/basic` now exposes tokenizer lexemes with exact source spans while
  preserving the existing byte-for-byte tokenizer API. Editor analysis therefore
  shares the ROM tokenizer's search order, no-boundary keyword matching, and
  quoted-string/`DATA`/`REM` modes.
- `@clementina/basic-lsp` diagnoses missing static targets for `GOTO`, `GO TO`,
  `GOSUB`, numeric `THEN`, `RUN`, and `ON...GOTO`/`ON...GOSUB` lists and resolves
  those targets with go-to-definition.
- Function signature help covers the ROM numeric/string functions and Clementina
  extension functions, including nested-call active parameters. Formatting uses
  the canonical compile/detokenize path to emit LIST-style source.
- Reference-aware renumbering is available through the protocol-neutral API and
  an LSP source action/execute command (default start/step 10). It updates targets
  that resolve to existing lines, preserves unresolved targets and lexical data,
  and revalidates the ROM's line-number and input-length limits.
- Focused core and real stdio-LSP coverage was added. Full repository verification
  passed: schema freshness, spec validation, all workspace builds, test TypeScript
  compilation, and all 69 tests. Nothing was committed or pushed.

## Update — complete BASIC editor and debugger work (2026-09-22)

- The language server now adds structural/function-arity diagnostics, contextual
  statement/function/variable completion, line and variable document symbols,
  references, validated rename, full core/extension callable signatures, and
  semantic tokens. Variable identity follows the ROM's two-significant-character
  rule. Real stdio-LSP tests cover the added protocol capabilities.
- The VS Code extension now contributes a BASIC TextMate grammar and language
  configuration. `Clementina BASIC: Renumber Program…` prompts for the first line
  and increment and delegates the edit to the language server.
- `specs/basic.json` records the current ROM's `NEWSTT2` statement hook and
  `CURLIN` addresses. `ClementinaBasicDebugSession` uses those facts for effective
  numbered-line breakpoints and line stepping, while preserving breakpoint
  ownership. It exposes live simple numeric/integer/string variables and lookup
  evaluation. Node debug composition, DAP, and VS Code now accept BASIC projects.
- Documentation and status files were updated to remove the old BASIC-debugging
  and syntax-coloring deferrals. Repository verification passes: schema freshness,
  specs, all workspace builds, test TypeScript compilation, and all 74 tests.
- `program.kind: mixed` remains rejected. Its ownership model is explicitly
  unresolved and cannot be selected silently: either BASIC must remain the entry
  program with returning assembly support loaded first, or assembly must take over
  after BASIC setup. This is the only BASIC-scope product decision still required.
- Nothing was committed or pushed.

## Update — held HID/gamepad automation (2026-09-26)

- `@clementina/emulator-client` and the sibling `clementina-6502` headless
  automation server now expose held HID usage press/release, complete HID bitmap
  replacement, complete 10-byte gamepad slot replacement, and gamepad clear.
  The MIA test hooks reuse held-state, device, event, and status handling without
  opening a UDP input session or advancing CPU cycles.
- The protocol and input layout are recorded in `specs/emulator-automation.json`,
  `specs/input.json`, and `docs/emulator-automation.md`.
- Verified: all 102 SDK tests and workspace builds; Go automation tests under
  `-race`; real emulator integration including BASIC `KEYDOWN`, `CONSDOWN`,
  `PADON`, `PADDIR`, and `PADBTN` press/release queries, plus the existing
  debugger, build, file, and renderer checks.
- Existing unrelated work in both repositories was left in place. Nothing was
  committed or pushed.
