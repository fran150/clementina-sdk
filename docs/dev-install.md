# Dev installs

A dev install runs local builds of the SDK and its companion tools in place of
the installed releases, without replacing them. Local builds go into one dev
folder, `~/.clementina/dev/bin` (set `CLEMENTINA_DEV_BIN` to use another), and
a shell switch puts that folder ahead of the installed tools on `PATH`. The
released copies stay where they are, so switching back is immediate and a
package-manager upgrade never overwrites a dev build.

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

## The shell switch

`npm run dev:install` also copies `scripts/clementina-dev.sh` to
`~/.clementina/dev/clementina-dev.sh`. Source it from a bash or zsh startup
file:

```sh
. ~/.clementina/dev/clementina-dev.sh
```

Then, in any shell:

```text
$ clementina-dev on        # dev folder first on PATH, in this shell only
$ clementina-dev status    # which copy of each tool this shell runs
clementina: dev, /Users/me/.clementina/dev/bin/clementina
clementina-automation: installed, /opt/homebrew/bin/clementina-automation
$ clementina-dev off       # back to the installed tools
```

The switch affects only the shell it runs in, so one terminal can use dev
builds while another uses the release. A tool without a dev build falls
through to the installed copy.

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
`code --install-extension --force`. Installing the release `.vsix` again
reverts it.

On Windows, `npm run dev:install` writes `.cmd` launchers; put the dev folder
first on `PATH` by hand, since the shell switch is for bash and zsh.
