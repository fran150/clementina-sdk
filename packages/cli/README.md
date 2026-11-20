# @clementina/cli

The `clementina` command line tool: create, build, run, check and debug
Clementina projects, and install and update the toolchain in `~/.clementina`.
See [CLI usage](../../docs/cli.md) for every command.

End users install it with the one-line installer from the
[SDK README](../../README.md), which puts a standalone executable in
`~/.clementina/bin`.

## Rebuilding a dev install

A dev install runs this checkout's CLI and MCP server in place of the installed
release. From the SDK root, the first time:

```sh
npm install
npm run dev:install
clementina dev on
```

`npm run dev:install` builds every package and writes launchers in
`~/.clementina/dev/bin` that run the built code in place, and `clementina dev on`
makes every terminal use them. After a change, rebuild:

```sh
npm run build
```

The launchers pick up the new build, so `dev:install` is not needed again.
Run `npm install` first when `package.json` or `package-lock.json` changed.
`clementina --version` names the commit of the dev build, and
`clementina dev off` switches back to the installed release.

The VS Code extension is rebuilt separately; see its
[README](../vscode-extension/README.md#rebuilding-a-dev-install). Dev builds of
the emulator and video client come from their own repositories. All of it is in
[dev installs](../../docs/dev-install.md).

## Development

```sh
npm run build -w @clementina/cli
npm run typecheck -w @clementina/cli
```

The workspace `npm test` runs the CLI tests in `tests/`.
