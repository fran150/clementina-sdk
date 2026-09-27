# Edit and check game code

Work in a portable project rooted at `clementina.yaml`. Keep source under the
manifest's `program.entry`/`program.sources`; keep reusable assets in the
versioned JSON files. This path works for BASIC and assembly projects. Mixed
program composition is still undefined.

1. Read the relevant SDK architecture document and spec before changing
   hardware-dependent behavior.
2. Edit source, then run `node packages/cli/bin/clementina.mjs project validate <project>`.
3. Put an observable expectation in `checks/smoke.json` (BASIC screen/input
   text) or `checks/code.json` (CPU memory bytes). Check files are workflow
   evidence, outside the portable asset manifest.
4. Run:

```sh
node agents/workflows/code-game.mjs <project> --emulator /path/to/clementina-automation
```

The command validates all assets and references, builds with the SDK, launches
the generated load plan through the ROM, and writes
`<outputDirectory>/inspection/report.json` plus native MIA video snapshots.
Add `--renderer /path/to/clementina-render` for 320×200 PNGs. It fails when
a declared check fails and closes the emulator even on failure.

For an assembly game, a deterministic memory check can be:

```json
{
  "format": "clementina-code-check",
  "version": 1,
  "settleCycles": 500000,
  "memory": [{"address": 512, "bytes": [42]}]
}
```

Each memory check may set `"phase": "after"` to inspect after the
`checks/smoke.json` input. Addresses are CPU addresses; checks read at most
256 bytes each. `settleCycles` is an emulator processing budget, not gameplay
timing or a physical-hardware claim. The assembly starter includes this check.

Compare the report, raw video, and optional PNG with the spec. Change source or
portable assets, adjust the expected behavior deliberately, and run again.
