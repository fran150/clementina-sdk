# Dev installs

A dev install runs local builds of the SDK and its companion tools in place of
the installed releases, without replacing them. Local builds go into one dev
folder, `~/.clementina/dev/bin` (set `CLEMENTINA_DEV_BIN` to use another), and
`clementina dev on` makes every terminal use them. The released copies stay
where they are, so switching back is immediate and `clementina update` never
overwrites a dev build.

| Repository | Command | Puts in the dev folder |
| --- | --- | --- |
| `clementina-sdk` | `npm run dev:install` | `clementina`, `clementina-mcp` |
| `clementina-6502` | `make dev-install` | `clementina-emulator`, `clementina-automation` |
| `clementina-video-client` | `make dev-install` | `clementina-video-client`, `clementina-render` |

`npm run dev:install` builds the SDK and writes two small launchers that run
the checkout's `packages/cli/bin/clementina.mjs` and
`packages/mcp/bin/clementina-mcp.mjs` with Node.js. After that, `npm run build`
is enough to update them. The Go repositories build their executables straight
into the folder; run `make dev-install` again after a change.

## Rebuilding after a change

From the SDK checkout:

```sh
npm install                                  # only when dependencies changed
npm run build                                # updates the dev clementina and clementina-mcp
npm run package --workspace clementina       # the VS Code extension
code --install-extension "packages/vscode-extension/build/clementina-$(node -p "require('./packages/vscode-extension/package.json').version").vsix" --force
```

Then reload the VS Code window. The first time, run `npm run dev:install` in
place of `npm run build`, then `clementina dev on`. The
[CLI](../packages/cli/README.md#rebuilding-a-dev-install) and
[extension](../packages/vscode-extension/README.md#rebuilding-a-dev-install)
READMEs repeat these steps.

## Dev mode

```text
$ clementina dev on        # every terminal uses the dev builds
Dev mode is on in every terminal. Commands use the dev builds in /Users/me/.clementina/dev/bin: clementina, clementina-automation, clementina-emulator, clementina-mcp.
$ clementina dev           # or dev status: whether it is on, and the dev builds
$ clementina dev off       # back to the installed tools
```

`dev on` writes `~/.clementina/dev/enabled`, so the mode holds in every
terminal and after a restart until `dev off`. While it is on:

- The installed `clementina` runs the dev build of the CLI for every command
  except `dev` and `update`, which it always runs itself. A broken checkout can
  therefore never stop `clementina dev off`.
- On macOS and Linux, the links in `~/.clementina/bin` of each tool with a dev
  build point at the dev build, so typing `clementina-emulator` runs it too.
  `dev off` points them back at the installed releases, and `install` and
  `update` leave them alone until then. On Windows, type the dev folder path
  to run a dev build by hand.
- `clementina` commands put the dev folder first on their own `PATH`, so
  `build`, `run`, `check`, the debugger and the MCP server start the dev
  emulator on every system.
- Each command prints a reminder on stderr (not with `--json`, nor for `mcp`),
  and `doctor` shows `dev mode: on`.

A tool without a dev build stays on its installed copy. `dev on` refuses when
the dev folder is empty, so a machine without dev builds cannot switch to them.

## Telling the copies apart

`clementina --version` prints the release version for a standalone executable
and names a checkout build with its commit:

```text
clementina 0.3.0-alpha.1 (dev build, commit 9071659, /Users/me/src/clementina-sdk)
```

`with local changes` follows the commit when tracked files differ from it.
`clementina doctor` starts with the same line and then prints, for each tool,
the path it found and that tool's own version line, so it shows which emulator
`clementina run`, the debugger and the MCP server will start. They find
`clementina-automation` on `PATH` unless `CLEMENTINA_EMULATOR` or `--emulator`
names another.

## Studio and the VS Code extension

Studio's dev version is `npm start` in its checkout; it uses the SDK checkout
next to it through its `file:` dependencies, so build the SDK first. The
installed Studio app is separate and unaffected.

For the extension, press `F5` in `packages/vscode-extension` to open a
development window, or package it with `npm run package --workspace clementina`
and install that `.vsix` over the released one with
`code --install-extension build/clementina-<version>.vsix --force` (the file comes
first, then `--force`). Installing the release `.vsix` again reverts it.

On Windows, `npm run dev:install` writes `.cmd` launchers. `clementina dev on`
switches the CLI and the tools it starts, but a dev tool typed by name in a
shell still runs the installed copy.
