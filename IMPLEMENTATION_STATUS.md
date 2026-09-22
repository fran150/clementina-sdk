# Implementation status

## Phase 1

Baseline implemented and updated to the fixed upstream state:

- loader anchored at `$04B7`
- audio indexes `$E6-$EF`
- default PHI2 1.2 MHz
- documented audio sequencer ABI

The former MIA-RAM overlap between default sequencer track addresses and SD/FS is
now resolved (relocatable tracks, `docs/compatibility.md`).

## Phase 2

Implemented:

- `clementina.yaml` manifest contract
- palette schema/type/validation
- palette-config schema/type/validation
- tileset schema/type/validation
- shape schema/type/validation
- animation schema/type/validation
- cross-asset reference and uniqueness validation
- same-tileset animation validation
- Studio v2 → portable SDK conversion
- portable SDK → Studio v2 conversion
- hardware attribute encoders
- example project and tests

## Phase 3

Implemented structured schema-backed diagnostics with throwing compatibility APIs,
Node project loading/saving, path and ID resolution, cross-asset checks, generated
schema freshness checks, bidirectional schema/type conformance, version policy,
and golden Studio conversion fixtures. Studio now imports SDK models/converters;
legacy session validators remain pending normalization/parity coverage.

See `docs/shared-packages.md` for filesystem atomicity and migration limitations.

## Phase 4

CLI validation commands, runtime doctor, shared project `build`, and owned-emulator
`run` are implemented with versioned JSON output, exit codes, and subprocess tests.
See `docs/cli.md`.

## Phase 5

Headless Go automation baseline and SDK client implemented with protocol validation,
serialized cycle stepping/inspection/input/video snapshots, Go race tests, and an
explicit cross-repository integration check. Rendering reuses the video client.
See `docs/emulator-automation.md` for limits and remaining debugger work.

## Next

Execution control and pre-opcode address breakpoints are now implemented.
Program loading now has a versioned load-plan schema, PRG helpers, BASIC bootstrap
generation, SD-backed real-ROM emulator launch, and end-to-end coverage.
Exact ld65 source mapping and source-breakpoint translation are now implemented.
Bounded source-line stepping and JSR step-over are now implemented over the same
transport-independent client. The editor-neutral `@clementina/debug` layer now
owns thread/frame/register views, replacement-style source breakpoints, command
serialization, stop polling, and Node project build/emulator/launch composition.
Next debugger increments remain held HID/gamepad automation and an actual thin
VS Code/DAP transport. Phase 8 BASIC tooling now includes portable-project
build/run composition and a baseline language server (diagnostics/hover/
completion); GOTO/GOSUB target validation and go-to-definition remain pending.
Continue Studio legacy validator migration with explicit compatibility coverage
before declaring Phase 6 complete.

## Phase 7

The first assembly layer is implemented in `@clementina/assembler`. It invokes
ca65/ld65 without a shell, supports ordered multi-file builds, produces binary,
PRG, listing, map, label and `.dbg` artifacts, validates linked placement, and
parses source files, lines, segments and symbols for debugger consumers. Memory
placement is still explicit input. The parser includes line span lists, and the
source map resolves exact source lines to emitted logical address ranges and back.

The asset package now emits exact palette-bank, complete palette-configuration,
and CHR-bank bytes using the canonical video layout. CHR placement is explicit.
Shapes and animations are not emitted because their runtime binary format remains
undefined.

Portable manifests now carry explicit build declarations for linker input, CPU
placement, palette selection and CHR-bank assignments. `@clementina/build` composes
those inputs into verified runtime artifacts, `load-plan.json`, and `bootstrap.bas`.
CLI `build` calls that API and returns artifact paths in JSON mode.

The Node-only emulator-client entry point now owns automation process startup,
readiness verification, SD mounting, and shutdown. CLI `run` builds the project,
launches its generated load plan, prints the endpoint, and remains attached until
interrupted. The transport-independent client remains browser-compatible.

## Phase 11 foundation

`@clementina/debug` exposes one source-aware 65C02 thread/frame, raw registers,
source breakpoint replacement and ownership, execution/step controls, memory reads,
and cancellable bounded stop polling. Its Node entry builds the project, starts the
owned emulator, creates the source map, permits breakpoints before launch, then
delegates the generated BASIC load plan. No VS Code dependency or DAP server is
included yet; editor integrations translate over this stable SDK layer.

## Phase 8

The first BASIC tooling increment is implemented in `@clementina/basic`. It parses
numbered portable source, mirrors the ROM tokenizer and all three extension tables,
emits raw `SAVE`/`LOAD` program files, optionally emits absolute links for a supplied
`TXTTAB`, validates existing program images and style sidecars, and detokenizes to
canonical `LIST`-style source. CLI `basic compile` writes the relocatable form.

A `program.kind: basic` manifest can declare `build.basic` (currently just an
`outputName`). `@clementina/build` compiles `program.entry` through
`@clementina/basic` and returns a discriminated `{kind: 'basic', basic, loadPlan,
files}` result alongside the existing `{kind: 'assembly', ...}` result; both write
`load-plan.json`. CLI `build`/`run` and `checkLoadPlanLaunch`'s direct-launch mode
(load/setup commands issued directly, then `LOAD`+`RUN`, instead of a numbered
bootstrap) share this contract with assembly projects. `program.kind: mixed` is
rejected during project validation, and `@clementina/debug` explicitly rejects a
non-assembly project rather than assuming ld65 debug records exist.

`@clementina/basic-lsp` is a baseline Language Server Protocol server. Its
protocol-agnostic core (`analyzeDiagnostics`, `hoverAt`, `completionsFor`) reuses
`@clementina/basic`'s parser/tokenizer/tables: whole-document diagnostics (every
numbered-line format/length/range error plus program-size overflow, not just the
first one `parseBasicSource` would stop at), hover (keyword category and exact
token bytes, in the ROM's own tokenizer search order), and keyword completion. A
Node entry (`clementina-basic-lsp`, on `vscode-languageserver`) wires that core to
stdio JSON-RPC. GOTO/GOSUB line-number target validation, go-to-definition,
signature help, formatting, and renumbering remain pending.
