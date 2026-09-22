# BASIC language server

`@clementina/basic-lsp` is an editor-neutral Language Server Protocol server for
Clementina BASIC source. It reuses `@clementina/basic`'s ROM-accurate tokenizer,
numbered-source parser, and token tables rather than reimplementing any of that
contract; see [BASIC tooling](basic-tooling.md) for what those actually do.

## Capabilities

- **Diagnostics**: every numbered-line format, length, and line-number-range
  violation `parseBasicSource` would report, plus a whole-program size-overflow
  check from `compileBasicProgram` — but for the *whole open document at once*
  rather than stopping at the first bad line the way interactive entry does.
  Each diagnostic is anchored to its physical source line.
- **Hover**: the keyword under the cursor, resolved against
  `basicTokenTables` in the ROM's own tokenizer search order (`MON`, extension
  functions, extension, extension2, primary), reporting its category and exact
  token byte(s) (e.g. `TRACK` → extension2 token `$FC,$A8`). A trailing `$`/`(`
  is only treated as part of the keyword when that longer form actually
  matches a table entry (`STR$`, `TAB(`), not for an ordinary function call
  like `CUE(0)`.
- **Completion**: every keyword across all four tables plus `MON`, filtered by
  the in-progress word before the cursor.

## Architecture

`src/index.ts` is protocol-agnostic and has no LSP-library or Node dependency
(browser-compatible, like `@clementina/debug`'s session core): `analyzeDiagnostics`,
`hoverAt`, and `completionsFor` are plain functions over document text and
positions. `src/server.ts` is the Node-only stdio wiring, built on
`vscode-languageserver`/`vscode-languageserver-textdocument` — the generic
Language Server Protocol library (editor-agnostic despite the package name; it
is not a VS Code dependency, the same way `@clementina/debug` avoids one).

This split exists so the language-service logic is reusable and directly
testable without spinning up a JSON-RPC transport, and so LSP-specific
dependencies don't ride along with every consumer of `@clementina/basic` (CLI,
build, emulator-client, debug) — the same reasoning that already keeps
`@clementina/debug` and `@clementina/emulator-client` separate from
`@clementina/assembler`/`@clementina/basic`.

## Running it

```sh
npx clementina-basic-lsp
```

The server always uses stdio (it passes explicit streams to `createConnection`
rather than relying on a `--stdio` flag, so it works with any launcher). Point
an editor's generic LSP client configuration at this binary for `.bas` files.

## What's not implemented yet

GOTO/GOSUB/THEN/`ON...GOTO` line-number target validation and go-to-definition
for line numbers, signature help, formatting, and renumbering are deferred to
a later increment. Diagnostics do not currently flag a `GOTO` to a
non-existent line — the ROM itself does not validate this at `SAVE` time
either (it is a runtime `UNDEF'D STATEMENT ERROR`), but a language server
could reasonably catch it earlier; that is intentionally the next increment
rather than a partial implementation now.
