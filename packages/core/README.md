# @clementina/core

Shared diagnostics, validation results, machine types, and JSON Schema checks for Clementina SDK packages. The bundled schemas come from the portable formats in [`specs/schema`](../../specs/schema/). Other packages use these helpers to report errors consistently; asset, project, and load-plan packages add their own semantic checks.

## Requirements

- Node.js 20 or newer, or an ES module bundler for browser use.
- A project using TypeScript should use a compatible ES module setup. Runtime schema checks use the installed `ajv` dependency.
- Portable asset and project documents must follow their versioned schemas. A project manifest is `clementina.yaml`; portable assets live in separate files listed by that manifest.

## Use

```sh
npm install @clementina/core
```

Check a JSON value and handle its diagnostics without throwing:

```js
import {assertValid, result, schemaDiagnostics} from '@clementina/core';

const palette = {
  format: 'clementina-palette', version: 1,
  id: 'palette:main', name: 'Main',
  colors: [0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0xf81f, 0x07ff],
};

const checked = result(palette, schemaDiagnostics('palette', palette));
if (!checked.ok) {
  console.error(checked.diagnostics);
} else {
  console.log(checked.value.name);
}

// When an exception is more convenient, this returns the value or throws
// ValidationError with the same diagnostics.
const validPalette = assertValid(checked);
```

`schemaDiagnostics(name, value)` accepts a bundled schema key such as `palette`, `shape`, `project`, or `load-plan`. It checks structure and field constraints without modifying the value. Its diagnostics use stable codes such as `schema.type`, a severity, a human-readable message, and a JSON Pointer `path`. An empty path points to the document root. `diagnostic(code, path, message)` creates an error entry for additional rules. `result(value, diagnostics)` succeeds with the value when no entry has error severity; warnings and information entries remain in a successful result.

Schema checks do not resolve cross-asset references or enforce package-specific semantic rules. For complete portable asset validation use `@clementina/assets`; for `clementina.yaml` and project references use `@clementina/project`; for load plans use `@clementina/basic`. See [shared packages](../../docs/shared-packages.md) for those boundaries.

## Development

From the repository root after `npm install`:

```sh
npm run build -w @clementina/core
npm run typecheck -w @clementina/core
npm test -w @clementina/core
node scripts/generate-schemas.mjs --check
```

The test command builds `dist` before running `tests/core.test.mjs`. Edit source schemas in `specs/schema`, then run `npm run generate:schemas`; `src/schemas.ts` is generated and should stay in sync. Run `npm test` for the full SDK suite.
