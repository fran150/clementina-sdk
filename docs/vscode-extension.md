# VS Code extension

The `clementina` extension (`packages/vscode-extension`) is a thin protocol/UI
client over two already-existing, editor-neutral SDK layers — it implements no
debugging or language logic of its own:

- **Debugging**: `@clementina/debug-adapter` (`packages/debug-adapter`) is a
  standalone stdio [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)
  server built on `@vscode/debugadapter` (the generic DAP library — editor-agnostic
  despite the package name, the same category of dependency as
  `vscode-languageserver`). It is a pure translation layer over
  `ClementinaDebugSession`/`createProjectDebugSession`
  (see [editor debugger integration](debugger.md)); no debugging behavior lives
  in the adapter itself.
- **BASIC language support**: `@clementina/basic-lsp`'s existing
  `clementina-basic-lsp` server (see [the BASIC language server](basic-lsp.md)),
  registered for `.bas` files through `vscode-languageclient`.

`packages/vscode-extension/src/extension.ts` is the entire integration: it
registers a `DebugAdapterDescriptorFactory` that spawns
`clementina-debug-adapter` and a `LanguageClient` that spawns
`clementina-basic-lsp`, both resolved from their package locations via
`require.resolve` (so a local workspace install works without a separate
global install step) and both spawned through `process.execPath` for
cross-platform reliability.

## What's implemented

Matching `@clementina/debug`'s actual capabilities exactly — nothing invented:

- Launch (build the project and start an owned emulator via
  `createProjectDebugSession`), source breakpoints, continue/pause,
  step-in/step-over.
- A single stack frame and a read-only **Registers** scope
  (PC/A/X/Y/SP/P/cycles/MIA-paused) sourced directly from `DebugRegisters`.
- Only assembly projects (`program.kind: assembly`) can be debugged. Launching
  a BASIC project surfaces `@clementina/debug`'s own
  `debug.program-kind` rejection as a clean DAP launch error, not a crash —
  its current source map is ld65-only.

Launch configuration:

```json
{
  "type": "clementina",
  "request": "launch",
  "name": "Launch Clementina project",
  "program": "${workspaceFolder}",
  "emulator": "/path/to/clementina-automation",
  "port": 0
}
```

`program` is the portable project root (containing `clementina.yaml`).
`emulator`/`port` are optional host-only settings, defaulting to
`clementina-automation` on `PATH` and an automatic loopback port — the same
defaults as CLI `run` (see [the CLI](cli.md)).

## What's deferred

Instruction-level stepping/disassembly view, variables/expression evaluation,
stack unwinding, and physical bank-selective breakpoints all require "separate
verified contracts" that `@clementina/debug` itself does not have yet (see
[editor debugger integration](debugger.md)). A BASIC/assembly TextMate grammar
(real syntax highlighting) is a separate, orthogonal effort not attempted here;
`.bas` files are still recognized as the `clementina-basic` language (required
for the language client to attach) but are not colorized.

## Trying it

This is not published to the Marketplace. Build the SDK (`npm run build`),
then either:

- Open `packages/vscode-extension` in VS Code and press `F5` to launch an
  Extension Development Host, or
- Package it with `npx vsce package` (from `packages/vscode-extension`) and
  install the resulting `.vsix` with `code --install-extension`.
