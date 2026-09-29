# @clementina/basic-lsp

Editor-neutral language support for Clementina BASIC. The package offers a
stdio Language Server Protocol (LSP) process and plain TypeScript functions for
diagnostics, completion, hover, navigation, rename, symbols, semantic tokens,
signature help, formatting, and renumbering. It uses `@clementina/basic` for
the ROM tokenizer, parser, token tables, and source limits.

## Requirements

- Node.js 20 or newer for the server.
- An editor with a generic LSP client for server use. Associate `.bas` files
  with the `clementina-basic-lsp` executable and use stdio transport.
- Numbered Clementina BASIC source encoded as printable 7-bit ASCII. The ROM
  accepts line numbers from 0 through 63999 and at most 71 input characters
  per source line.

Install with `npm install @clementina/basic-lsp`. Launch the server from your
editor with `clementina-basic-lsp` (or `npx clementina-basic-lsp`). The server
uses stdin and stdout for JSON-RPC; it does not require a `--stdio` flag.

## Library example

```ts
import {
  analyzeDiagnostics,
  definitionAt,
  formatBasicSource,
  renumberBasicSource,
} from '@clementina/basic-lsp';

const source = '10 GOTO 30\n30 ? "Hello"\n';
analyzeDiagnostics(source);                 // []
definitionAt(source, 1, 9);                 // {line: 2, startCharacter: 0, endCharacter: 2}
formatBasicSource(source);                  // '10 GOTO 30\n30 PRINT "Hello"\n'
renumberBasicSource(source, {start: 100, step: 10});
// '100 GOTO 110\n110 ? "Hello"\n'
```

Library positions use one-based physical line numbers and zero-based character
columns. The server converts them to LSP's zero-based line numbers. Formatting
and renumbering operate on effective program lines: a later duplicate replaces
an earlier line, and a bare line number deletes that line. Renumbering updates
static existing targets after `GOTO`, `GO TO`, `GOSUB`, `THEN`, and `RUN`.

For the full feature list and ROM behavior, see
[the language server guide](../../docs/basic-lsp.md) and
[the BASIC tooling guide](../../docs/basic-tooling.md).

## Development

From the repository root, install dependencies with `npm install`, then run:

```sh
npm run build -w @clementina/basic
npm run build -w @clementina/basic-lsp
npm run typecheck -w @clementina/basic-lsp
npm run test -w @clementina/basic-lsp
```

The package test exercises the library API and a real stdio LSP session.
