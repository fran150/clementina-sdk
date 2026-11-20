# Clementina for VS Code

Edit, build and debug Clementina projects in VS Code: BASIC (`.cbas`), ca65
assembly (`.s`, `.inc`) and ld65 linker configuration (`link.cfg`) language
support, `clementina.yaml` checking, and
debugging BASIC and assembly together in the emulator. The language servers and
the debug adapter are bundled in the extension; the emulator comes from
`clementina install`. See [the VS Code extension](../../docs/vscode-extension.md)
for what it does and how it is built.

## Rebuilding a dev install

To replace the installed extension with a build of this checkout, run from the
SDK root on the machine where VS Code runs:

```sh
npm install
npm run package --workspace clementina
code --install-extension "packages/vscode-extension/build/clementina-$(node -p "require('./packages/vscode-extension/package.json').version").vsix" --force
```

`npm run package` builds the SDK and the extension bundle, then writes
`build/clementina-<version>.vsix` in this folder. `code --install-extension`
installs it over the installed copy (the file comes first, then `--force`).
Then run **Developer: Reload Window** in VS Code. If `code` is not found, run
**Shell Command: Install 'code' command in PATH** from the VS Code command
palette.

Run both commands again after every change. Installing a released `.vsix`
reverts to the release. To try a change without installing, open
`packages/vscode-extension` in VS Code and press `F5` for a development window.

The extension starts the emulator from `~/.clementina/bin`, so with
`clementina dev on` it debugs with the dev emulator. Rebuilding the CLI and the
other tools is in [dev installs](../../docs/dev-install.md).
