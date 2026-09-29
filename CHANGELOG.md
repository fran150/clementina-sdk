# Changelog

## Unreleased

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

The first distributed release will establish the package release history.
