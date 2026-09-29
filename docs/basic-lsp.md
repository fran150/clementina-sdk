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
  statement or expression context, plus variables already used in the document.
- **Line targets**: precise diagnostics and go-to-definition for static targets
  after `GOTO`, `GO TO`, `GOSUB`, numeric `THEN`, and `RUN`, including the
  comma-separated target lists used by `ON...GOTO`/`ON...GOSUB`. The analysis
  follows the ROM tokenizer's no-boundary matching and ignores apparent keywords
  inside quoted strings, `DATA`, and `REM`.
- **Signature help**: argument names and the active argument for the ROM's
  built-in numeric/string functions, core statements, and every Clementina
  extension callable, including nested calls.
- **Symbols and refactoring**: effective numbered lines and variables appear as
  document symbols. References and rename work for variables and for numbered
  lines plus their static targets, with new names checked against the ROM tokenizer.
- **Semantic tokens**: tokenizer-derived keyword, operator, literal, comment,
  variable, and line-number spans are available to any semantic-token client.
- **Formatting**: round-trips through the canonical tokenizer and detokenizer,
  producing ROM `LIST`-style source. Effective program lines are sorted, keywords
  are uppercased, and quoted/`DATA`/`REM` text keeps its lexical content. If a
  canonical line exceeds the ROM's 71-character input limit, formatting keeps
  that valid source line's shorthand instead.
- **Renumbering**: the `Renumber BASIC program` source action defaults to line 10
  with a step of 10 and updates static references to existing lines. The VS Code
  command prompts for both values. Undefined
  targets are preserved so the target diagnostic remains visible. The operation
  rejects results outside 0–63999 or beyond the ROM's input-line limit.

## Architecture

`src/index.ts` exports the protocol-agnostic modules for source analysis,
diagnostics, keyword lookup, navigation, editor features, and transforms. They
have no LSP-library or Node dependency (browser-compatible, like
`@clementina/debug`'s session core): their public functions accept document
text and positions. `src/server.ts` is the Node-only stdio wiring, built on
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

The formatter and renumberer intentionally operate on the effective program the
ROM would retain after numbered lines are entered in order. Duplicate line numbers
therefore keep their last definition, and a bare numbered line deletes an earlier
definition.
