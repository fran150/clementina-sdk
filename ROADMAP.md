# Clementina SDK roadmap

## Phase 0 — scaffold
**Complete.**

## Phase 1 — canonical machine specification
**Baseline complete.** Current baseline uses the `$04B7` ascending loader, audio indexes `$E6-$EF`, a 1.2 MHz default PHI2, and the documented MIA audio-sequencer ABI.

The former audio-sequencer/SD MIA-RAM overlap is now resolved via relocatable
sequencer tracks; see `docs/compatibility.md`.

## Phase 2 — portable project and asset formats
**Baseline complete.**

Implemented project manifest, versioned JSON schemas, TypeScript types/validators,
cross-reference validation, Studio v2 conversion, examples, and tests.

## Phase 3 — shared core packages
**Baseline implemented; incremental Studio migration started.**

1. structured diagnostics instead of exception-only validation;
2. filesystem project reader/writer;
3. schema ↔ TypeScript conformance tests/code generation;
4. stable asset-id/path resolver;
5. migration/golden-fixture policy;
6. migrate Studio to `@clementina/assets` and `@clementina/project`.

## Phase 4 — CLI
**Build/run baseline implemented.** Validation commands, `doctor`, assembly `build`,
and owned headless-emulator `run` use shared APIs with JSON diagnostics and stable
exit codes.

## Phase 5 — emulator automation
**Headless baseline implemented.** Serialized Go automation, bounded cycle stepping,
inspection, console-byte input, video snapshots, and `@clementina/emulator-client`.
Run/pause/resume, bounded instruction stepping and pre-opcode address breakpoints
are implemented through the same serialized machine owner.
Exact ld65 source-line/address maps and source-breakpoint translation reuse those
address breakpoints. Bounded source-line stepping and JSR step-over reuse serialized
instruction stepping. Physical bank-selective breakpoints remain pending.
The existing Go video compositor is exposed for headless PNG rendering. See
`docs/emulator-automation.md` for verification and pending debugger capabilities.
The program-loading increment adds validated PRG packing, ordered MIA/CPU load plans,
generated BASIC bootstrap source, SD-root mounting, and real-ROM emulator launch.
The Node lifecycle entry point owns the Go process and powers CLI `run`.

## Phase 6 — Studio integration completion
Studio becomes a client of SDK contracts instead of a parallel implementation.

## Phase 7 — assembly
**Build baseline implemented.** The Node ca65/ld65 adapter accepts explicit source
order and linker placement, emits PRG/debug/map/label artifacts, verifies linked
segment placement, and parses source symbols. Portable manifests can declare
assembly and explicit palette/CHR placement; the shared project composer and CLI
`build` emit the load plan and BASIC bootstrap. Generated includes, linker configs,
and runtime support remain pending. ld65 span parsing, bidirectional source maps, and
exact source breakpoints and source stepping are implemented.

## Phase 8 — BASIC
**Tokenizer/file baseline and portable-project build/run composition implemented.**
`@clementina/basic` mirrors the current ROM's primary and extension token tables,
lexical behavior, numbered-source limits, raw SAVE/LOAD records, optional absolute
links, style-sidecar inspection, and canonical detokenization. CLI `basic compile`
writes relocatable files whose links are rebuilt by ROM `LOAD`.

A `program.kind: basic` manifest can now declare `build.basic`; `@clementina/build`
compiles the entry source and emits a load plan whose terminal step is the compiled
program, discriminated from the assembly build result. CLI `build`/`run` use the
same contract as assembly projects. The load plan's direct-launch mode (as opposed
to a numbered bootstrap) issues MIA/CPU setup as direct BASIC commands, then `LOAD`
and `RUN`. `program.kind: mixed` composition remains explicitly rejected until its
rules are defined. `@clementina/debug`'s current source map is ld65-only and
explicitly rejects a BASIC project rather than silently misbehaving.

`@clementina/basic-lsp` now provides a baseline BASIC language server: whole-document
diagnostics (numbered-line format/length/range plus program-size overflow), hover
(keyword category and exact token bytes), and keyword completion, all built on
`@clementina/basic`'s existing tokenizer/tables rather than a second implementation.
GOTO/GOSUB line-number target validation, go-to-definition, signature help,
formatting, and renumbering remain pending.

## Phase 9 — agent workflows
Vendor-neutral game/asset/code/debug workflows.

## Phase 10 — MCP
Structured agent tools.

## Phase 11 — VS Code
**Baseline extension implemented.** `@clementina/debug`
provides editor-neutral thread/frame/register views, source breakpoint ownership,
execution controls, source stepping, stop polling, and Node build/process/launch
composition. `@clementina/debug-adapter` is a standalone stdio DAP server
translating that layer's capabilities one-to-one (launch, source breakpoints,
continue/pause/step, a single stack frame, and a read-only registers scope) —
no debugging logic of its own. The `clementina` VS Code extension is a thin
client registering that adapter plus `@clementina/basic-lsp`'s language server
for `.bas` files; see `docs/vscode-extension.md`. Instruction-level
stepping/disassembly, variables/expression evaluation, stack unwinding,
physical bank-selective breakpoints, and syntax highlighting remain pending.
