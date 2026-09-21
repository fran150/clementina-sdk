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

## Next

Phase 5 emulator automation. Continue Studio legacy validator migration with
explicit compatibility coverage before declaring Phase 6 complete.
