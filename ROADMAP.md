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
**Next.**

1. structured diagnostics instead of exception-only validation;
2. filesystem project reader/writer;
3. schema ↔ TypeScript conformance tests/code generation;
4. stable asset-id/path resolver;
5. migration/golden-fixture policy;
6. migrate Studio to `@clementina/assets` and `@clementina/project`.

## Phase 4 — CLI
`project validate`, `asset validate`, `sprite validate`, `animation validate`, then build/run.

## Phase 5 — emulator automation
Stable control/debug API plus `@clementina/emulator-client`.

## Phase 6 — Studio integration completion
Studio becomes a client of SDK contracts instead of a parallel implementation.

## Phase 7 — assembly
ca65/ld65 integration, generated includes, linker configs, runtime support.

## Phase 8 — BASIC
Compiler/tokenizer/file output and later LSP.

## Phase 9 — agent workflows
Vendor-neutral game/asset/code/debug workflows.

## Phase 10 — MCP
Structured agent tools.

## Phase 11 — VS Code
Thin client over SDK/CLI/LSP.
