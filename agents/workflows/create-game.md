# Create a game

This workflow starts a BASIC or assembly game from an SDK template, validates
its portable assets and references, builds a ROM-loadable program, and checks
observable behavior in a headless emulator. It uses SDK commands and files, so
it works with any agent or shell.

## 1. Read the contract and choose the path

Read [compatibility](../../docs/compatibility.md), the
[architecture overview](../../docs/architecture/overview.md),
[video](../../docs/architecture/video.md),
[input](../../docs/architecture/input.md), and
[storage](../../docs/architecture/storage.md) before changing hardware-dependent
behavior. Check the corresponding `specs/machine.json`, `specs/video.json`,
`specs/input.json`, `specs/basic.json`, `specs/assets.json`, and
`specs/schema/*.schema.json`. Use the SDK validators and build tools for exact
limits and references. `program.kind: mixed` build composition is still
unresolved.

## 2. Create and edit a portable project

From the SDK root, after `npm ci && npm run build`:

```sh
node agents/workflows/create-game.mjs init /path/to/my-game --name "My Game"
# For a 65C02 assembly starter instead:
node agents/workflows/create-game.mjs init /path/to/my-asm-game --kind assembly --name "My Assembly Game"
```

The destination must be new. The BASIC starter contains `clementina.yaml`,
`src/main.bas`, JSON palette assets, and `checks/smoke.json`. Its input loop
accepts `A` to score and `R` to restart. The assembly starter contains
`src/main.s`, an explicit `link.cfg`, and `checks/code.json`; it writes 42 to CPU
RAM `$0200`. Both manifests use project-relative source paths. Keep reusable
asset data in portable JSON files under `assets/` and use the matching schemas
in `specs/schema/`.

Edit the source and assets for the game. When behavior changes, update
`checks/smoke.json` with visible text and input for BASIC, or `checks/code.json`
with expected CPU memory bytes for assembly. These files are workflow checks,
outside the portable asset manifest. Cycle budgets are emulator automation
limits, not gameplay timing or a claim about hardware speed. See the
[coding workflow](code-game.md) for the check format.

## 3. Validate and build

```sh
node packages/cli/bin/clementina.mjs project validate /path/to/my-game
node packages/cli/bin/clementina.mjs build /path/to/my-game
```

Project validation checks every listed asset against its schema, cross-asset IDs,
manifest paths, build settings, and source files. To examine one asset while
editing, use `asset validate <file>`; follow it with project validation to catch
broken references. The BASIC build compiles `src/main.bas` to `build/game.bas`;
the assembly build links `src/main.s` with `link.cfg`. Both emit
`build/load-plan.json`. Build output is generated; `clementina.yaml`, source,
and JSON assets remain the editable project.

For a live session, run:

```sh
node packages/cli/bin/clementina.mjs run /path/to/my-game \
  --emulator /path/to/clementina-automation
```

This builds and launches the same plan, then prints an automation endpoint.
Press Ctrl-C to close that session. The bounded `check` command below also
launches the emulator and records evidence.

## 4. Run and inspect

Build `clementina-automation` from the emulator repository as described in
[emulator automation](../../docs/emulator-automation.md). For PNGs, build the
optional `clementina-render` command from `clementina-video-client`.

```sh
node agents/workflows/create-game.mjs check /path/to/my-game \
  --emulator /path/to/clementina-automation \
  --renderer /path/to/clementina-render
```

`check` repeats project validation and build, mounts the generated SD root,
launches the load plan through the ROM, pauses the emulator, advances a bounded
number of cycles, and captures CPU and MIA video state. For the BASIC starter,
it injects `A`, checks prompt and score text on the overlay and a changed video
snapshot, and compares loaded palette bytes with the generated asset. For the
assembly starter, it checks CPU RAM `$0200`. It exits nonzero if a declared
check fails. The emulator process is closed after inspection. `--emulator` defaults to
`CLEMENTINA_EMULATOR` or `clementina-automation` on `PATH`; `--renderer` can be
omitted when only state and overlay text are needed.

Open `build/inspection/report.json` for CPU registers, cycle count, overlay rows,
snapshot hashes, and check results. `before.video.bin` and `after.video.bin` are
raw 68,944-byte MIA video snapshots. With `--renderer`, inspect `before.png` and
`after.png` at native 320×200. The PNG is a composed frame; the raw snapshot is
video state, not RGB pixels. Compare the observed frame and state with the
relevant spec, adjust the game or its smoke check, then validate and run again.
