# Clementina SDK

Shared, vendor-neutral development SDK for the Clementina homebrew computer.

The SDK provides portable `clementina.yaml` projects and versioned assets;
validation and build APIs; assembly and BASIC tooling; the Clementina library of 6502 routines;
headless emulator automation; and editor-neutral debugging. Studio uses the
SDK for portable projects and its Builder tab. Assembly and BASIC projects
share the [load-plan contract](docs/program-loading.md). Assembly builds use a
generated BASIC bootstrap to load assets and start machine code.

See [shared packages](docs/shared-packages.md) for APIs and versioning.
The `@clementina/*` packages are configured for public npm distribution under
[GPLv3](LICENSE); the VS Code extension is distributed separately.
See [releasing](docs/releasing.md) for package and CI gates, and
[dev installs](docs/dev-install.md) for running local builds in place of the
installed tools.

Start with:

1. `docs/architecture/overview.md`
2. `docs/project-format.md`
3. `docs/gamedev/asset-model.md`
4. `specs/schema/`

To create and inspect a game end to end, follow the
[agent workflows](agents/workflows/create-game.md). For structured tools in an
MCP host, see the [MCP server](docs/mcp.md).

Run:

```sh
npm ci
npm test
```

`npm run build` compiles every package in dependency order through TypeScript
project references (`tsc -b`) and skips packages that are already up to date.
`npm run clean` removes the build output.

CLI: `npx clementina --help` after building, or download a standalone executable
that needs no Node.js. See [CLI usage](docs/cli.md).
