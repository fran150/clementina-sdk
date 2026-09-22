# Clementina CLI

Build the SDK with `npm ci && npm run build`, then run `npx clementina --help`
from this workspace (or `node packages/cli/bin/clementina.mjs --help`).

```sh
npx clementina project validate examples/minimal-game
npx clementina asset validate examples/minimal-game/assets/palettes/main.palette.json
npx clementina sprite validate examples/minimal-game/assets/shapes/player_idle.shape.json
npx clementina animation validate examples/minimal-game/assets/animations/player_idle.animation.json
npx clementina doctor
```

`project validate` defaults to the current directory. It reads `clementina.yaml`,
loads listed assets, validates references and ensures program source files exist.
Standalone validation checks an asset's structure and local semantic rules. It cannot
check external references; use project validation for that. `sprite validate` accepts
a portable shape, since a shape is the portable container for hardware sprites.

Append `--json` for a single JSON object on stdout, with `version: 1`, `ok`,
`diagnostics`, and `exitCode` (plus `message` for help/doctor). Failures do not mix
human text into JSON output. Human-mode diagnostics go to stderr. Exit status is
0 for success, 1 for validation/I/O errors, and 2 for invalid command arguments.
No command modifies project files.

`doctor` checks the Node runtime requirement. It does not yet probe emulator,
assembler, or BASIC capabilities. Build/run commands will be added with their
respective reusable toolchain and automation packages; they are not placeholder
successes today.

A reusable headless emulator client is now available; see
[emulator automation](emulator-automation.md). CLI build/run still require program
assembly/linker and asset-output adapters and are not enabled by this baseline.
The reusable load-plan and emulator launch layer is documented in
[program loading](program-loading.md).
