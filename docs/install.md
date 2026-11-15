# Installing

One command installs the SDK's `clementina` command-line tool and the rest of
the toolchain on macOS, Linux and Windows. It downloads releases from GitHub
and needs no Node.js, Go or C compiler.

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/fran150/clementina-sdk/main/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/fran150/clementina-sdk/main/install.ps1 | iex
```

Then open a new terminal and run `clementina doctor`. Run the same command
again to update.

## What it installs

The script downloads the standalone `clementina` executable from the newest SDK
release into `~/.clementina/bin`, checks it against the release's
`SHA256SUMS`, and runs `clementina install`. That command installs the
companion releases this SDK release was tested with:

| Tool | Commands | Release |
| --- | --- | --- |
| `cc65` | `ca65`, `ld65`, `ar65`, `cc65`, `cl65`, `da65`, `od65` | `cc65-v*` release of this repository, built by the [cc65 workflow](../.github/workflows/cc65.yml) |
| `emulator` | `clementina-emulator`, `clementina-automation` | `fran150/clementina-6502` |
| `video-client` | `clementina-video-client`, `clementina-render` | `fran150/clementina-video-client` |
| `studio` | Clementina Studio | `fran150/clementina-studio` |

The tested versions are `TOOL_RELEASES` in
[`packages/cli/src/install.ts`](../packages/cli/src/install.ts). Every download
is checked against its release's `SHA256SUMS` before anything is replaced.

Everything lives in `~/.clementina` (set `CLEMENTINA_HOME` to use another
folder):

- `tools/<tool>/` holds each tool's release files.
- `bin/` holds `clementina` and, on macOS and Linux, links to every tool's
  commands.
- `installed.json` records the installed versions. A tool already at its tested
  version is not downloaded again unless you pass `--force`.

Studio goes where each system expects an app: `~/Applications` on macOS (with
the download quarantine cleared, because alpha builds are not notarized), an
AppImage in `tools/studio` with a `clementina-studio` command and a desktop
entry on Linux, and the Windows installer's per-user install with a Start menu
entry. Studio has no Linux arm64 build; `install` skips it there.

## PATH

`clementina install` adds the tools to `PATH` for new terminals. On macOS and
Linux it appends one line, marked `# Added by clementina install`, to the
startup file of your shell (`~/.zshrc`, `~/.bashrc`, or `~/.profile`). On
Windows it adds `~\.clementina\bin` and the tool folders to the user `Path`.
`--no-modify-path` skips this. `clementina` commands find the installed tools
even before `PATH` is updated: they search the Clementina folders after `PATH`.

## Choosing what to install

`clementina install` with no names installs everything. Name tools to install
only those:

```sh
clementina install emulator video-client
```

The install script passes its arguments on: `curl -fsSL … | sh -s -- emulator`.
In PowerShell, set `$env:CLEMENTINA_INSTALL_ARGS = 'emulator'` first.
`CLEMENTINA_VERSION=v0.3.0-alpha.1` makes the script install that SDK release
instead of the newest one.

## Other ways to install

- npm: `npm install -g @clementina/cli@alpha`, then `clementina install`.
- Homebrew on macOS and Linux: the `fran150/clementina` tap. Its cc65 comes from
  Homebrew; skip `clementina install cc65` there.
- Every release page also lists the files for manual download.

To work on the SDK or its tools themselves, see [dev installs](dev-install.md).
