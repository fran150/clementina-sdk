# Implementation status

## Phase 1

Baseline implemented and updated to the fixed upstream state:

- loader anchored at `$04B7`
- audio indexes `$E6-$EF`
- default PHI2 1.2 MHz
- documented audio sequencer ABI

A separate current MIA-RAM overlap between sequencer tracks and SD/FS is recorded in
`docs/compatibility.md`.

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

Initial CLI validation commands and runtime doctor implemented with versioned JSON
output, exit codes, and subprocess tests. Build/run remain dependent on adapters.
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
Next: emulator process lifecycle and CLI `run`, then debugger source mapping.
Continue Studio legacy validator migration with explicit compatibility coverage
before declaring Phase 6 complete.

## Phase 7

The first assembly layer is implemented in `@clementina/assembler`. It invokes
ca65/ld65 without a shell, supports ordered multi-file builds, produces binary,
PRG, listing, map, label and `.dbg` artifacts, validates linked placement, and
parses source files, lines, segments and symbols for debugger consumers. Memory
placement is still explicit input; project build declarations and asset output
composition are the next increment.

The asset package now emits exact palette-bank, complete palette-configuration,
and CHR-bank bytes using the canonical video layout. CHR placement is explicit.
Shapes and animations are not emitted because their runtime binary format remains
undefined.

Portable manifests now carry explicit build declarations for linker input, CPU
placement, palette selection and CHR-bank assignments. `@clementina/build` composes
those inputs into verified runtime artifacts, `load-plan.json`, and `bootstrap.bas`.
CLI `build` calls that API and returns artifact paths in JSON mode.
