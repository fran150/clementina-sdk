# Clementina SDK

Shared, vendor-neutral development SDK for the Clementina homebrew computer.

## Status

- **Phase 1:** machine/developer specification baseline complete
- **Phase 2:** portable project + asset format baseline complete
- **Phase 3:** shared diagnostics, filesystem APIs, resolution, conformance and initial Studio integration implemented

See `docs/shared-packages.md` for package APIs and versioning policy.

Phase 2 defines `clementina.yaml` and portable versioned assets for palettes,
palette-bank configs, tilesets, shapes, and animations. The contracts are derived
from Clementina Studio's actual current model and validators.

Start with:

1. `docs/architecture/overview.md`
2. `docs/project-format.md`
3. `docs/gamedev/asset-model.md`
4. `specs/schema/`
5. `ROADMAP.md`

Run:

```sh
npm install
npm test
```
