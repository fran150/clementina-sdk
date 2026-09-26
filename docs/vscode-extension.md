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
  registered for `.bas` files through `vscode-languageclient`. It provides
  diagnostics, hover, contextual completion, symbols/references/rename,
  line-target navigation, signatures, semantic tokens, formatting, and renumbering.

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
- Assembly projects use ld65 source maps. BASIC projects use the ROM statement
  boundary and current-line state for source breakpoints and line stepping, plus a
  **BASIC Variables** scope and simple-variable hover/watch evaluation.
- `.bas` files have a TextMate grammar and language configuration, and the
  **Clementina BASIC: Renumber Program…** command prompts for start and step.

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

Disassembly view, stack unwinding, physical bank-selective breakpoints, and richer
evaluation of arbitrary BASIC expressions require separate verified contracts in
`@clementina/debug`; see [editor debugger integration](debugger.md).

## Trying it

This is not published to the Marketplace. Build the SDK (`npm run build`),
then either:

- Open `packages/vscode-extension` in VS Code and press `F5` to launch an
  Extension Development Host, or
- Package it with `npx vsce package` (from `packages/vscode-extension`) and
  install the resulting `.vsix` with `code --install-extension`.
