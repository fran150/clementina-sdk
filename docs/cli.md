# Clementina CLI

Build the SDK with `npm ci && npm run build`, then run `npx clementina --help`
from this workspace (or `node packages/cli/bin/clementina.mjs --help`).

## Standalone executable

The CLI also ships as a single-file executable that needs no Node.js install.
Tagged releases attach `clementina-linux-x64`, `clementina-linux-arm64`,
`clementina-darwin-x64`, `clementina-darwin-arm64`, and
`clementina-windows-x64.exe` with a `SHA256SUMS` file. Download the one for your
platform, rename it to `clementina` (or `clementina.exe`), make it executable,
and put it on `PATH`. It runs every command below; `build` and `run` still need
cc65 and the emulator automation executable, exactly as with the npm package.
macOS may quarantine a downloaded file; clear that with
`xattr -d com.apple.quarantine clementina`.

To build the executables locally, install [Bun](https://bun.sh) and run
`npm run build:binaries`. Bun compiles the built CLI together with its own
runtime for every target from one machine; outputs go to `dist/bin/`. Pass
target names to `node scripts/build-binaries.mjs` (for example `linux-x64`)
after `npm run build` to build a subset. Node.js remains the development and
library runtime: Studio, the MCP server, and the VS Code extension consume the
npm packages unchanged.

```sh
npx clementina project validate examples/minimal-game
npx clementina asset validate examples/minimal-game/assets/palettes/main.palette.json
npx clementina sprite validate examples/minimal-game/assets/shapes/player_idle.shape.json
npx clementina animation validate examples/minimal-game/assets/animations/player_idle.animation.json
npx clementina basic compile src/main.bas build/game.bas
npx clementina build path/to/project
npx clementina run path/to/project --emulator /path/to/clementina-automation
npx clementina doctor
```

`project validate` defaults to the current directory. It reads `clementina.yaml`,
loads listed assets, validates references and ensures program source files exist.
Standalone validation checks an asset's structure and local semantic rules. It cannot
check external references; use project validation for that. `sprite validate` accepts
a portable shape, since a shape is the portable container for hardware sprites.

Append `--json` for a single JSON object on stdout, with `version: 1`, `ok`,
`diagnostics`, and `exitCode` (plus `message` where relevant and `data` for build
or run details). Failures do not mix human text into JSON output. Human-mode
diagnostics go to stderr. Exit status is
0 for success, 1 for validation/I/O errors, and 2 for invalid command arguments.
Validation commands do not modify project files. `build` writes only within the
manifest's declared build output directory.

`basic compile` reads printable 7-bit numbered source and writes the ROM's binary
`SAVE`/`LOAD` format. Its output contains relocatable links that ROM `LOAD` rebuilds;
it is not a PRG and must not overwrite the source file. See
[BASIC tooling](basic-tooling.md).

`run` performs the same validated build, starts one owned headless emulator, mounts
the build result's `sdRoot` (`<outputDirectory>/sd` for asset builds, otherwise
the project root), enters the generated load plan through the ROM
(a numbered bootstrap for an assembly project, direct commands for a BASIC project),
and prints the loopback automation endpoint. It remains attached so debugger clients
can use that endpoint; press Ctrl-C to stop and dispose of the emulator. The default
executable is `clementina-automation` from `PATH`. Override it with `--emulator` or
the host-only `CLEMENTINA_EMULATOR` environment variable. `--port 0` selects an
available loopback port; values 1-65535 request a fixed port. These host settings
are deliberately absent from the portable project manifest.

With `build.assets`, copy the contents of `<outputDirectory>/sd` to the SD
card. It contains the program, asset files and tokenized `BOOT.BAS`; from that
directory, `LOAD "BOOT.BAS"` then `RUN`. The build message and JSON assembly
result include `sdRoot`.

`doctor` checks Node.js (or reports the standalone executable) and probes `ca65`, `ld65`, and `ar65` by running their
version commands. It checks whether the emulator automation executable is
available without starting it. Missing optional tools produce warnings; use
`doctor --strict` to require all four tools and return a nonzero exit code.
`doctor --emulator /path/to/clementina-automation` checks an explicit binary,
and `--json` includes machine-readable tool paths and results. `build`/`run`
support a `program.kind: assembly` project
(`build.assembly`, requires ca65 and ld65; asset builds also require ar65) or
a `program.kind: basic` project (`build.basic`, compiled through
`@clementina/basic`). Assembly builds already generate a BASIC loader, so this
startup does not require `program.kind: mixed`; the reserved `mixed` enum is
rejected during project validation. `--json` `data` distinguishes the two with
`kind: "assembly"` or `kind: "basic"`. Both kinds can be launched by the source
debugger; see [the debugger](debugger.md).

A reusable headless emulator client is available; see
[emulator automation](emulator-automation.md). CLI `build` uses the shared project
composer, and CLI `run` composes it with the Node emulator lifecycle API.
The reusable load-plan and emulator launch layer is documented in
[program loading](program-loading.md).
