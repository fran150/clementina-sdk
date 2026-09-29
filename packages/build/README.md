# @clementina/build

Builds a portable Clementina project from `clementina.yaml`. The package loads and validates project assets, compiles an assembly or ROM BASIC program, creates a checked load plan, and writes the files needed to launch it. Assembly projects can also include encoded SD card assets, generated ca65 declarations, a memory report, and the Clementina runtime library.

The manifest and assets remain portable project files. Generated files belong in the manifest's `build.outputDirectory`.

## Requirements

- Node.js 20 or newer.
- A valid `clementina.yaml` and asset files matching the [project schema](../../specs/schema/project.schema.json) and the relevant [asset schemas](../../specs/schema/). Paths are relative to the project root.
- For assembly builds, `ca65`, `ld65`, and an ld65 linker configuration. Asset builds also require `ar65`. Install these tools from cc65 and put them on `PATH`.
- BASIC builds use the SDK compiler and do not invoke the external assembler tools.

The project manifest selects the program source, build kind, output directory, and any video or asset placements. The SDK validates those choices; it does not choose memory addresses or a linker layout for the game.

## Use

```sh
npm install @clementina/build
```

A minimal BASIC project can use this `clementina.yaml` alongside `main.bas`:

```yaml
format: clementina-project
version: 1
name: Hello
target:
  machine: clementina-6502
program:
  kind: basic
  entry: main.bas
assets:
  palettes: []
  paletteConfigs: []
  tilesets: []
  backgrounds: []
  overlays: []
  shapes: []
  animations: []
build:
  outputDirectory: build
  basic:
    outputName: HELLO
```

Use numbered BASIC source, for example `10 PRINT "HELLO"` followed by `20 END`. Build the project from Node.js:

```ts
import {buildProject} from '@clementina/build';

const built = await buildProject('/path/to/project');
if (!built.ok) {
  console.error(built.diagnostics);
} else {
  console.log(built.value.sdRoot, built.value.loadPlan);
  console.log(built.value.files.map(file => file.path));
}
```

`buildProject` returns a `ValidationResult`. On success, `value.kind` is `basic` or `assembly`; `value.files` lists files written by this package, and `value.loadPlan` contains ordered load steps. `diagnostics` may contain asset build warnings. If the manifest has no asset build, `sdRoot` is `.` and load-plan paths include the build directory. With an asset build, `sdRoot` is `<outputDirectory>/sd` and load-plan paths are relative to that folder.

For an assembly project with assets, see the [runtime demo](../../examples/runtime-demo/clementina.yaml). Its build produces `assets.inc`, `assets.s`, a `runtime/` library, `memory-report.json`, a card folder containing asset files and a PRG, `BOOT.BAS`, `bootstrap.bas`, and `load-plan.json`. The generated asset declarations and file formats are described in the [builder guide](../../docs/gamedev/builder.md). The [loading guide](../../docs/program-loading.md) describes how to use the load plan.

## Library helpers

`planAssetBuild(project)` is a pure planning step for an already validated `PortableProject`. It returns encoded asset bytes, ca65 source text, slot locations, and a memory report without writing files. `renderAssetsInc(plan)` and `renderAssetsS(plan)` render those generated sources. `buildRuntime(root, folder, checks, runner?)` copies and assembles the runtime modules into a project-relative folder and returns the project-relative path to `runtime.lib`. `runtimeCodeSize(listing)` measures the CODE segment from a ca65 listing. `buildProject(root, runner?)` accepts a `ProcessRunner` for deterministic tooling in integrations and tests.

## Development

From the SDK workspace root after `npm install`:

```sh
npm run build -w @clementina/build
npm run typecheck -w @clementina/build
node --test tests/build.test.mjs tests/builder.test.mjs
```

The builder tests include a real toolchain build when `ca65`, `ld65`, and `ar65` are available. The workspace `npm test` runs broader integration coverage.
