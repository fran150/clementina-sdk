# Clementina SDK

Shared, vendor-neutral development SDK for the Clementina homebrew computer.

## Status

- **Phase 1:** machine/developer specification baseline complete
- **Phase 2:** portable project + asset format baseline complete
- **Phase 3:** shared diagnostics, filesystem APIs, resolution, conformance and initial Studio integration implemented

- **Phase 4:** validation CLI implemented
- **Phase 5:** headless emulator automation, owned Node process lifecycle, and
  ld65-backed source breakpoints/stepping;
  see `docs/emulator-automation.md`
- **Phase 7:** ca65/ld65, explicit palette/CHR composition, and CLI build baseline;
  see `docs/assembly.md`
- **Phase 8:** ROM-compatible BASIC tokenizer, SAVE/LOAD file compiler, inspector,
  detokenizer, CLI output, and portable-project build/run composition;
  see `docs/basic-tooling.md` and `docs/program-loading.md`
- **Phase 11 foundation:** editor-neutral debug session and Node project-debug
  composition (assembly projects only); see `docs/debugger.md`

Assembly and BASIC projects use the portable load-plan contract described in
`docs/program-loading.md`. `program.kind: mixed` composition is not defined yet.

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

Initial CLI: `npx clementina --help` after building. See `docs/cli.md`.
