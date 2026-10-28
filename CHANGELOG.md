# Changelog

## Unreleased

- PRG files carry a 2-byte load-address header with no bank byte. Load plans pick each PRG bank with `BANK n:` and start the program with `BRUN`, `MIALOAD` steps no longer emit a length, and the BASIC tokenizer keeps hex digits after `$` (up to 6) raw instead of crunching `CD` or `DEF`, matching the ROM.
- Generate `clementina.inc` and `mia.inc` from `specs/` (`npm run generate:includes`) and put them on every assembly build's include path; the asset runtime uses MIA's names from them.
- Add automated package-content checks and CI for supported Node versions.
- Make the SDK npm packages publishable under GPL-3.0-only.
- Check assembler and emulator availability through `clementina doctor`.
- Add a physical hardware audio fixture and capture analysis workflow.
- Build packages through TypeScript project references (`npm run build` runs `tsc -b`; `npm run clean` removes output).
- Share `errorMessage`, `formatHex`, `isIntegerInRange`, and `SerialQueue` from `@clementina/core` instead of per-package copies.
- Export the default emulator executable and `CLEMENTINA_EMULATOR` lookup from `@clementina/emulator-client/node`.
- Raise `DebugSessionError` from BASIC debug sessions, matching assembly sessions.
- Ship the CLI as standalone executables for Linux, macOS, and Windows that need no Node.js install (`npm run build:binaries`; attached to tagged GitHub releases).
- Embed the ca65 runtime sources as `runtimeFiles` in `@clementina/runtime`; builds write them instead of copying from the package directory.
- Bundle the VS Code extension with its debug adapter and BASIC language server so the `.vsix` packages from the workspace (`npm run package` in `packages/vscode-extension`).

The first distributed release will establish the package release history.
