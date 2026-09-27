# Releasing the SDK

The root workspace stays private. Every `@clementina/*` package is configured
for public npm publication under GPL-3.0-only and includes the license text.
The `clementina` VS Code extension is a separate Marketplace artifact and stays
private to npm; it carries the same license. Confirm npm scope and Marketplace
publisher ownership before the corresponding external publication step.
The portable project and asset format versions are independent of npm versions;
see [shared packages](shared-packages.md).

## Release checks

Run from a clean checkout:

```sh
npm ci
npm run release:check
```

The gate checks schema freshness, specs, builds, tests, TypeScript, workspace
dependency versions, and the files in every npm package. The
[emulator integration workflow](../.github/workflows/emulator-integration.yml)
tests against the companion Go repositories. Its checkout needs access to those
repositories; configure `CLEMENTINA_COMPANION_TOKEN` when the default GitHub
token cannot read them. Review the [physical verification](hardware-verification.md)
record separately before calling a release hardware-tested.

## Version and publish order

Use one npm version for all workspaces and update each exact internal
`@clementina/*` dependency to that version. Update `CHANGELOG.md` and the
package lockfile in the same change. `npm run check:packages` rejects mismatched
workspace dependency versions or missing entry points. Tag a release only after
the checks above pass.

Publish npm packages in dependency order: `core`, `assets`, `project`, `basic`,
`assembler`, `runtime`, `build`, `emulator-client`, `debug`, `basic-lsp`,
`debug-adapter`, `cli`, and `mcp`. For a public release, use
`npm publish --workspace @clementina/<name> --access public` for each package
after verifying npm scope ownership. The repository's npm version and the VS
Code extension's version must stay aligned. Package the extension only after
its npm dependencies are available; its Marketplace publisher must be verified
before publication.

Publishing and Marketplace upload are external release actions and are not
performed by the repository checks.
