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
`SHA256SUMS`, and runs `clementina install`. That command installs the newest
release of each tool, alphas included:

| Tool | Commands | Release |
| --- | --- | --- |
| `cc65` | `ca65`, `ld65`, `ar65`, `cc65`, `cl65`, `da65`, `od65` | `cc65-v*` release of this repository, built by the [cc65 workflow](../.github/workflows/cc65.yml) |
| `emulator` | `clementina-emulator`, `clementina-automation` | `fran150/clementina-6502` |
| `video-client` | `clementina-video-client`, `clementina-render` | `fran150/clementina-video-client` |
| `studio` | Clementina Studio | `fran150/clementina-studio` |

Every download is checked against its release's `SHA256SUMS` before anything
is replaced.

Everything lives in `~/.clementina` (set `CLEMENTINA_HOME` to use another
folder):

- `tools/<tool>/` holds each tool's release files.
- `bin/` holds `clementina` and, on macOS and Linux, links to every tool's
  commands.
- `installed.json` records the installed versions. A tool already at the
  version asked for is not downloaded again unless you pass `--force`.

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

## Choosing tools and versions

`clementina install` with no names installs everything at its newest release.
Name tools to install only those, and add `@version` to pick a release:

```sh
clementina install emulator video-client
clementina install emulator@0.4.0-alpha.1 cc65@2.19
```

A version may be written with or without its `v` (`0.4.0-alpha.1` or
`v0.4.0-alpha.1`); cc65 versions name the `cc65-v<version>` release. Running
`clementina install` again moves each tool to its newest release.

The install scripts install the newest SDK release unless told otherwise. On
macOS and Linux, pass `--version` and any `clementina install` arguments after
`sh -s --`:

```sh
curl -fsSL https://raw.githubusercontent.com/fran150/clementina-sdk/main/install.sh | sh -s -- --version 0.3.0-alpha.2
curl -fsSL https://raw.githubusercontent.com/fran150/clementina-sdk/main/install.sh | sh -s -- emulator@0.4.0-alpha.1
```

In PowerShell, `irm | iex` cannot pass arguments, so run the script as a script
block:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/fran150/clementina-sdk/main/install.ps1))) -Version 0.3.0-alpha.2 emulator@0.4.0-alpha.1
```

`CLEMENTINA_VERSION` (and `CLEMENTINA_INSTALL_ARGS` for PowerShell) do the same
through the environment.

## Other ways to install

- npm: `npm install -g @clementina/cli@alpha`, then `clementina install`.
- Homebrew on macOS and Linux: the `fran150/clementina` tap. Its cc65 comes from
  Homebrew; skip `clementina install cc65` there.
- Every release page also lists the files for manual download.

To work on the SDK or its tools themselves, see [dev installs](dev-install.md).
