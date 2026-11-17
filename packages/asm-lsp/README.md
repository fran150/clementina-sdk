# @clementina/asm-lsp

`@clementina/asm-lsp` is an editor-neutral Language Server Protocol server for
Clementina assembly: ca65 syntax for the W65C02S (`specs/machine.json`). The VS
Code extension bundles it for `.s` and `.inc` files (see the SDK's docs/vscode-extension.md); any editor with a generic LSP
client can run `clementina-asm-lsp` over stdio.

## What it does

- **ca65's own errors and warnings as you type.** The editor's text, saved or
  not, is assembled with `ca65 --cpu 65C02` and the include directories and
  defines a build uses (`build.assembly.includeDirectories` and `defines`, then
  `<outputDirectory>/include`, `/lib` and the output directory itself, then the
  library). Messages about an included file appear in that file, and ca65's notes
  (such as where a macro was defined) are related information. When ca65 reads an
  unknown word as a label missing its colon, the message says the word is not a
  65C02 instruction or a macro. An `.inc` file is not assembled on its own: its
  errors show while a source that includes it is open.
- **Hover.** An instruction shows what it does, the flags it changes and every
  addressing mode with its opcode, length and cycles, with the mode the line uses
  in bold (zero page or absolute is chosen as ca65 does: `z:`/`a:`, a known value
  below $100, or a zero-page symbol). A directive shows its syntax. A symbol shows
  its definition line, its value when it is a constant expression (in hex, decimal
  and, for a byte, binary), its structure offset or enumeration value, the comment
  above or after it, and where it is defined. A label shows its address once a
  build has written the ld65 label file (`<outputDirectory>/<outputName>.lbl`). A
  number shows its other bases.
- **Go to definition, references, highlights and rename** across the workspace's
  sources and the Clementina library: labels, `.proc` and `.scope` names and the
  labels inside them (`scope::name`), cheap locals (`@name`, between two normal
  labels), constants, `.set` variables, macros, `.define`s, `.struct`, `.union`
  and `.enum` members, and unnamed labels (`:-`, `:++`). An `.import`ed name goes
  to the module that exports it. `.include` paths are links. Library symbols
  cannot be renamed.
- **Completion**: instructions and macros where an instruction goes, symbols in an
  operand (the current procedure's first), cheap locals after `@`, and directives
  after `.`. The library's internal names (`cl__*`, `*_INC`) are left out.
- **Signature help** for macro arguments, with the macro's comment.
- **Outline and workspace symbols**: procedures, scopes, structures and macros
  with what they contain. **Folding** for blocks and long comment runs.
- Macros from `.macpack generic` and `.macpack longbranch` are known.

The server writes the library's sources (`@clementina/lib`) to a folder of its
own, so go to definition can open `clementina-lib.inc` and the routines behind
its macros.

## Finding ca65

The server uses the `ca65Path` option when set, else the ca65 that
`clementina install` put in the Clementina home (`~/.clementina`, or
`CLEMENTINA_HOME`), else `ca65` on `PATH`. Without ca65 everything but the errors
still works, and the editor says once that ca65 was not found.

## Running it

```sh
npx clementina-asm-lsp
```

It speaks JSON-RPC on stdin and stdout. Initialization options, all optional:

| Option | Meaning |
| --- | --- |
| `libraryDirectory` | Where to write the library's sources. Default: a folder in the system's temporary directory. |
| `ca65Path` | The ca65 executable. |
| `diagnostics` | `onType` (default), `onSave` or `off`. |

`workspace/didChangeConfiguration` with a `clementina.assembly` section changes
`ca65Path` and `diagnostics`. The server indexes every `.s`, `.inc` and `.asm`
file in the workspace folders (not `node_modules`, dot folders or a build's
copies of the library), and follows `workspace/didChangeWatchedFiles` for
sources, `clementina.yaml` and label files.

The package also exports the services as functions (`AsmWorkspace`, `hoverAt`,
`completionsAt`, `signatureHelpAt`, `documentOutline`, `assembleForDiagnostics`
and the instruction and directive tables). Their positions are zero-based lines
and characters, as in LSP.
