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
and golden Studio conversion fixtures. Studio now imports SDK models/converters
and delegates Studio v2 session validation to the SDK. Legacy optional fields and
identity rules have compatibility coverage.

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
A DAP transport and VS Code extension are now implemented (Phase 11). Held
HID/gamepad automation now exposes press/release, full HID bitmap replacement,
and four complete gamepad slots through the SDK client and headless emulator.
Phase 8 BASIC tooling now includes portable-project
build/run/debug composition and a language server with diagnostics, semantic
navigation/refactoring, signatures, formatting, and renumbering.
Phase 6 Studio validation migration is complete; Studio's project and graphical
asset validators now delegate to `@clementina/project`, and its audio validators
delegate to `@clementina/assets/audio`.

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

## Phase 11

`@clementina/debug` exposes one source-aware thread/frame, raw registers, source
breakpoint replacement and ownership, execution/step controls, memory reads, and
cancellable bounded stop polling. Assembly sessions use ld65 source maps. BASIC
sessions use the specified ROM statement boundary and `CURLIN`, filter a shared
address breakpoint by requested line number, and expose live simple variables and
variable evaluation. Its Node entry supports both project kinds.

`@clementina/debug-adapter` is a standalone stdio DAP server (`clementina-debug-adapter`,
built on `@vscode/debugadapter`) that translates that layer one-to-one: launch,
source breakpoints, continue/pause/step-in/step-over, a single stack frame,
registers, and BASIC variables/evaluation. It has no debugging logic of its own. A real DAP
request race (real clients, including VS Code, pipeline `setBreakpoints`
alongside `launch` rather than waiting for it to finish) and an unhandled-exception
crash path were found and fixed during verification.

The `clementina` VS Code extension (`packages/vscode-extension`) registers that
adapter plus `@clementina/basic-lsp`'s language server, BASIC TextMate grammar,
language configuration, and interactive renumber command for `.bas` files. See
`docs/vscode-extension.md`. Disassembly, stack unwinding, and physical
bank-selective breakpoints remain pending for assembly debugging.

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
rejected during project validation until its execution rules are defined.

`@clementina/basic-lsp` is an editor-neutral Language Server Protocol server. Its
protocol-agnostic core reuses `@clementina/basic`'s parser/tokenizer/tables for
whole-document parse/size/static-target/structural diagnostics, token hover,
context-aware completion, line and variable symbols/references/rename, line-target
definition lookup, full callable signatures, semantic tokens, canonical LIST-style
formatting, and reference-aware renumbering. The canonical tokenizer exposes
source spans so strings, DATA, REM, and the ROM's no-boundary keyword behavior stay
consistent across compilation and editor analysis. A Node entry
(`clementina-basic-lsp`, on `vscode-languageserver`) wires those capabilities to
stdio JSON-RPC; VS Code also exposes configurable start/step renumbering.
