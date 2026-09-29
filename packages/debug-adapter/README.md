# @clementina/debug-adapter

A standalone Debug Adapter Protocol (DAP) server for Clementina assembly and
BASIC projects. It translates editor requests into `@clementina/debug` sessions;
that package owns breakpoints, stepping, source mapping, and emulator cleanup.
The adapter runs over stdio and is also used by the Clementina VS Code extension.

## Requirements

- Node.js 20 or newer.
- A portable project root containing `clementina.yaml`.
- A Clementina emulator with the version 1 automation API. By default, the
  `clementina-automation` executable must be on `PATH`; the launch request can
  provide its path with `emulator`.
- Assembly projects need `ca65` and `ld65` from cc65 for the project build.

The adapter builds the project and prepares an owned emulator when it receives a
launch request. It accepts source breakpoints before `configurationDone`, then
starts execution. Assembly sessions expose source breakpoints, verified stack
callers, registers, stepping, and forward disassembly. BASIC sessions also expose
simple variables and variable-name hover or watch evaluation.

## Use from an editor

Install the package and launch its `clementina-debug-adapter` bin as a stdio DAP
server. A DAP `launch` request uses these arguments:

```json
{
  "program": "/projects/my-game",
  "emulator": "/path/to/clementina-automation",
  "port": 0
}
```

`program` is the project directory, not an individual source file. `emulator`
and `port` are optional; the default port is chosen automatically on loopback.
For example, a VS Code `launch.json` entry with the Clementina extension is:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "clementina",
      "request": "launch",
      "name": "Launch Clementina project",
      "program": "${workspaceFolder}"
    }
  ]
}
```

An editor implementing DAP should send `initialize`, `launch`, optional
`setBreakpoints`, and `configurationDone` in the usual DAP sequence. Breakpoint
line numbers are one based. The server uses stdio for DAP traffic, so start it
as a child process rather than typing requests into a terminal.

## Development

From the SDK workspace root, build dependencies first if needed with
`npm run build`. Then run:

```sh
npm run build -w @clementina/debug-adapter
npm run typecheck -w @clementina/debug-adapter
node --test tests/debug-adapter.test.mjs
```

The workspace `npm test` runs broader integration coverage. The project debug
layer is documented in [docs/debugger.md](../../docs/debugger.md); the emulator
automation contract is in
[specs/emulator-automation.json](../../specs/emulator-automation.json).
