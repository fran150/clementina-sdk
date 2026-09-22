# Clementina SDK roadmap

## Phase 0 — scaffold
**Complete.**

## Phase 1 — canonical machine specification
**Baseline complete.** Current baseline uses the `$04B7` ascending loader, audio indexes `$E6-$EF`, a 1.2 MHz default PHI2, and the documented MIA audio-sequencer ABI.

The current audio-sequencer/SD MIA-RAM overlap remains tracked in `docs/compatibility.md`.

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
**Initial validation CLI implemented.** `project validate`, `asset validate`,
`sprite validate`, `animation validate`, and runtime `doctor`, with JSON diagnostics
and stable exit codes. Build/run depend on later adapters.

## Phase 5 — emulator automation
**Headless baseline implemented.** Serialized Go automation, bounded cycle stepping,
inspection, console-byte input, video snapshots, and `@clementina/emulator-client`.
Run/pause/resume, bounded instruction stepping and pre-opcode address breakpoints
are implemented through the same serialized machine owner.
The existing Go video compositor is exposed for headless PNG rendering. See
`docs/emulator-automation.md` for verification and pending debugger capabilities.
The program-loading increment adds validated PRG packing, ordered MIA/CPU load plans,
generated BASIC bootstrap source, SD-root mounting, and real-ROM emulator launch.

## Phase 6 — Studio integration completion
Studio becomes a client of SDK contracts instead of a parallel implementation.

## Phase 7 — assembly
**Build baseline implemented.** The Node ca65/ld65 adapter accepts explicit source
order and linker placement, emits PRG/debug/map/label artifacts, verifies linked
segment placement, and parses source symbols. Portable manifests can declare
assembly and explicit palette/CHR placement; the shared project composer and CLI
`build` emit the load plan and BASIC bootstrap. Generated includes/linker configs,
runtime support, CLI `run`, and debugger source mapping remain pending.

## Phase 8 — BASIC
Compiler/tokenizer/file output and later LSP.

## Phase 9 — agent workflows
Vendor-neutral game/asset/code/debug workflows.

## Phase 10 — MCP
Structured agent tools.

## Phase 11 — VS Code
Thin client over SDK/CLI/LSP.
