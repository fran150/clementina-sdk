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

## Next

Phase 3 should turn this baseline into the shared production packages used by Studio:
structured diagnostics, filesystem project loading/saving, schema/type conformance tests,
asset path/id resolution, migration policy, and then removing Studio's duplicate validators.
