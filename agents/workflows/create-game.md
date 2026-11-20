# Create a game

This workflow starts a game from an SDK starter, validates
its portable assets and references, builds a ROM-loadable program, and checks
observable behavior in a headless emulator. It uses SDK commands and files, so
it works with any agent or shell.

## 1. Read the contract and choose the path

Read the [architecture overview](../../docs/architecture/overview.md),
[video](../../docs/architecture/video.md),
[input](../../docs/architecture/input.md), and
[storage](../../docs/architecture/storage.md) before changing hardware-dependent
behavior. Check the corresponding `specs/machine.json`, `specs/video.json`,
`specs/input.json`, `specs/basic.json`, `specs/assets.json`, and
`specs/schema/*.schema.json`. Use the SDK validators and build tools for exact
limits and references. A project is a BASIC `program.entry`, `build.assembly`, or
both; see [program parts](../../docs/project-format.md#program-parts).

## 2. Create and edit a portable project

```sh
clementina new /path/to/my-game --name "My Game"
```

`node agents/workflows/create-game.mjs init <directory> [--name <name>]`
does the same from an SDK checkout.

The destination must be new or an empty directory. The starter has both
[program parts](../../docs/project-format.md#program-parts): `clementina.yaml`,
`src/main.cbas`, JSON palette assets, `src/hello.s` with `link.cfg`, and
`checks/smoke.json`. The program prints a line, calls the assembly routine
`hello` with `SYS $7000`, which prints another through the kernel, and waits
for a key; the smoke check presses `A`. `examples/catch-the-star` is a
complete game built from the starter. `build.basic.memoryTop` keeps
BASIC below the routine at `$7000`. Remove `build.assembly` (and the `SYS`) for
a BASIC-only project, or `program.entry` and `build.basic` for an assembly
program that takes over the machine. The manifest uses project-relative source paths. Keep reusable
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
clementina project validate /path/to/my-game
clementina build /path/to/my-game
```

Project validation checks every listed asset against its schema, cross-asset IDs,
manifest paths, build settings, and source files. To examine one asset while
editing, use `asset validate <file>`; follow it with project validation to catch
broken references. The BASIC build compiles `src/main.cbas` to `build/sd/GAME.BAS`;
the assembly build links `src/main.s` with `link.cfg`. Both emit
`build/load-plan.json`. Build output is generated; `clementina.yaml`, source,
and JSON assets remain the editable project.

For a live session, run:

```sh
clementina run /path/to/my-game
```

This builds and launches the same plan, then prints an automation endpoint.
Press Ctrl-C to close that session. The bounded `check` command below also
launches the emulator and records evidence.

## 4. Run and inspect

Install `clementina-automation` from the emulator release (see
[emulator automation](../../docs/emulator-automation.md)). For PNGs, install
the optional `clementina-render` command from `clementina-video-client`.

```sh
clementina check /path/to/my-game --renderer clementina-render
```

`check` repeats project validation and build, mounts the generated SD root,
launches the load plan through the ROM, pauses the emulator, advances a bounded
number of cycles, and captures CPU and MIA video state. For the starter, it
injects `A`, checks prompt and score text on the overlay and a changed video
snapshot, compares loaded palette bytes with the generated asset, and checks
the score at CPU RAM `$0280` after the input. It exits nonzero if a declared
check fails. The emulator process is closed after inspection. `--emulator` defaults to
`CLEMENTINA_EMULATOR` or `clementina-automation` on `PATH`; `--renderer` can be
omitted when only state and overlay text are needed. From an SDK checkout,
`node agents/workflows/create-game.mjs check` does the same.

Open `build/inspection/report.json` for CPU registers, cycle count, overlay rows,
snapshot hashes, and check results. `before.video.bin` and `after.video.bin` are
raw 68,944-byte MIA video snapshots. With `--renderer`, inspect `before.png` and
`after.png` at native 320×200. The PNG is a composed frame; the raw snapshot is
video state, not RGB pixels. Compare the observed frame and state with the
relevant spec, adjust the game or its smoke check, then validate and run again.
