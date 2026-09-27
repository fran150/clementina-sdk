# Clementina SDK

Shared, vendor-neutral development SDK for the Clementina homebrew computer.

## Status

The planned paths for phases 0–12 are delivered. See the [roadmap](ROADMAP.md)
for scope and defined limits.

The SDK provides portable `clementina.yaml` projects and versioned assets;
validation and build APIs; assembly and BASIC tooling; a 6502 asset runtime;
headless emulator automation; and editor-neutral debugging. Studio uses the
SDK for portable projects and its Builder tab. Assembly and BASIC projects
share the [load-plan contract](docs/program-loading.md). Assembly builds use a
generated BASIC bootstrap to load assets and start machine code.

See [shared packages](docs/shared-packages.md) for APIs and versioning.

Start with:

1. `docs/architecture/overview.md`
2. `docs/project-format.md`
3. `docs/gamedev/asset-model.md`
4. `specs/schema/`
5. `ROADMAP.md`

To create and inspect a game end to end, follow the
[agent workflows](agents/workflows/create-game.md). For structured tools in an
MCP host, see the [MCP server](docs/mcp.md).

Run:

```sh
npm install
npm test
```

CLI: `npx clementina --help` after building. See [CLI usage](docs/cli.md).
