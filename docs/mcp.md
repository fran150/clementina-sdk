# MCP server

`@clementina/mcp` exposes the shared SDK APIs to local MCP hosts over stdio.
Configure a host to launch the `clementina` command with one argument:

```sh
clementina mcp
```

The standalone executables bundle the server, so this needs no Node.js. The
npm package also installs it as the `clementina-mcp` binary, and in an SDK
checkout `node packages/mcp/bin/clementina-mcp.mjs` runs it from the build. Standard output is reserved for MCP
messages. Each tool takes structured arguments and returns a JSON text block
plus `structuredContent`; validation failures return diagnostics and
`isError: true`.

| Tool | Operation |
| --- | --- |
| `project_validate` | Load and validate `clementina.yaml`, all listed assets, references, and source paths. |
| `asset_validate` | Validate a supplied asset object; project references require `project_validate`. |
| `project_build` | Run `@clementina/build` and return artifact paths, load plan, and diagnostics. |
| `emulator_launch` | Build a project, own a headless Go emulator, and launch its load plan. |
| `emulator_state`, `emulator_control`, `emulator_step` | Inspect and control execution through `@clementina/emulator-client`. |
| `emulator_input`, `emulator_read_memory` | Inject raw console bytes and inspect CPU-addressed memory. |
| `emulator_audio`, `emulator_video_snapshot` | Inspect audio registers or save native MIA video bytes under the project build folder. |
| `emulator_stop` | Close the owned process. |

Paths are local to the MCP server process. A connection owns at most one
emulator session. Stop it before launching another project; the server also
closes it when the MCP connection ends. Project build writes only its declared
build output, using the SDK's project path checks. The server does not duplicate
asset, build, memory, or emulator rules.

`emulator_launch` starts the load plan. Call `emulator_control` with `pause`
before `emulator_step`; stepping requires a paused machine. Use
`emulator_video_snapshot` to save raw MIA state, then inspect it with a native
320×200 renderer if pixels are needed.

For a full game creation loop, use the [agent workflows](../agents/workflows/create-game.md).
MCP is a transport for the same SDK operations, not a separate project format.
