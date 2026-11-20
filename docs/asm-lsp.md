# The assembly language server

`@clementina/asm-lsp` is an editor-neutral Language Server Protocol server for
Clementina assembly: ca65 syntax for the W65C02S (`specs/machine.json`). The VS
Code extension bundles it for `.s` and `.inc` files and ld65 linker configurations (`link.cfg`) (see
[the VS Code extension](vscode-extension.md)); any editor with a generic LSP
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
- **Bank switches under banked code.** A store to VIA Port A (`VIA_ORA`,
  `VIA_ORA_NH` or a mirror, as `sta`, `stx`, `sty` or `stz` with an absolute
  address, or a macro whose body does one) in a segment the project's linker
  configuration puts in `$8000-$BFFF` is a warning: it maps another bank under
  the running code, so the next instruction is read from the new bank. The bank
  comes from `build.assembly.banks` or the area's `bank` attribute. A store right
  after a plain `lda #n` (`ldx`, `ldy`) of the code's own bank maps the same bank
  again and is not reported, unless the store has a label. Banks are switched
  from code below `$8000`, such as a far-call routine
  ([code in several banks](project-format.md#code-in-several-banks)).

The server writes the library's sources (`@clementina/lib`) to a folder of its
own, so go to definition can open `clementina-lib.inc` and the routines behind
its macros.

## Linker configurations (link.cfg)

The same server handles ld65 linker configurations, the `link.cfg` a project
names in `build.assembly.linkerConfig` (language id `clementina-ld65`; the server
also takes any `.cfg` file it is sent):

- **Checks as you type.** The server's own checks follow ld65 2.19's rules: the
  six blocks (MEMORY, FILES, SEGMENTS, FEATURES, SYMBOLS, FORMATS) and MEMORY
  before FILES and SEGMENTS, each block's attributes and their values (`type`,
  `yes`/`no`, `%O` or a quoted file), required attributes (`start` and `size`,
  `load`, a symbol's `type` and `value`), names defined twice, a `load` or `run`
  naming no memory area (names are case-sensitive), only one of `align`, `start`
  and `offset`, and expressions (`+ - * /`, parentheses, numbers, `%S` and
  SYMBOLS names; ld65 has no other operators). When they find no error, ld65
  itself checks the unsaved text: ld65 reads the whole configuration before it
  looks for object files, so it runs with none and writes nothing.
- **Clementina's memory map** (`specs/cpu-memory-map.json`). A memory area that
  takes the kernel's zero page ($F0-$FF), the system's spare ($E0-$E7), the stack,
  the clock snapshot, the kernel variables or the kernel image ($0400-$15FF) gets
  a warning; WozMon's zero page gets a note. When the project has a BASIC program
  (`program.entry`), BASIC's zero page ($00-$97), the line input buffer and
  BASIC's interpreter and heap ($1600 up to `build.basic.memoryTop`, $C000 when it
  is not set) are warned about too, with the `memoryTop` to set. I/O ($C000-$DFFF)
  and MIA ($E000-$FFFF) are warned about when a segment or file uses the area.
  Areas that overlap each other (in the same `bank`), areas past $FFFF and a `zp`
  segment outside zero page are warnings as well.
- **The project.** In the project's own `linkerConfig`, the first area written to
  `%O` must start at `build.assembly.loadAddress`, and every segment the
  project's sources use (`.segment "NAME"`, `.code`, `.zeropage`...) must be in
  SEGMENTS, or ld65 fails with "Missing memory area assignment".
- **Hover**: a block or attribute shows what it does and its values; a memory area
  shows its range, size, end, file, the segments in it and which Clementina memory
  it covers; a segment shows where it loads and runs and the source lines that use
  it; a number shows its decimal value and what is at that address; `%O`, `%S` and
  SYMBOLS names show their values.
- **Completion**: blocks, then names (the free zero page, page 2 and RAM at the
  load address for MEMORY; the segments the sources use, then the usual ones, for
  SEGMENTS), attributes not yet given, and values: types, `yes`/`no`, memory
  areas, segments, `%O`/`""`, and for a memory area's `start` the free places in
  Clementina's memory.
- **Go to definition** from `load`, `run` and expressions to the memory area,
  segment or symbol, the **outline** of blocks and their entries, and **folding**.

## Finding ca65 and ld65

The server uses the `ca65Path` option when set, else the ca65 that
`clementina install` put in the Clementina home (`~/.clementina`, or
`CLEMENTINA_HOME`), else `ca65` on `PATH`. Without ca65 everything but the errors
still works, and the editor says once that ca65 was not found. ld65 is found the
same way (`ld65Path`); without it linker configurations get only the server's
own checks.

## Running it

```sh
npx clementina-asm-lsp
```

It speaks JSON-RPC on stdin and stdout. Initialization options, all optional:

| Option | Meaning |
| --- | --- |
| `libraryDirectory` | Where to write the library's sources. Default: a folder in the system's temporary directory. |
| `ca65Path` | The ca65 executable. |
| `ld65Path` | The ld65 executable. |
| `diagnostics` | When ca65 and ld65 run: `onType` (default), `onSave` or `off`. The linker configuration's own checks always run. |

`workspace/didChangeConfiguration` with a `clementina.assembly` section changes
`ca65Path`, `ld65Path` and `diagnostics`. The server indexes every `.s`, `.inc` and `.asm`
file in the workspace folders (not `node_modules`, dot folders or a build's
copies of the library), and follows `workspace/didChangeWatchedFiles` for
sources, `clementina.yaml` and label files.

The package also exports the services as functions (`AsmWorkspace`, `hoverAt`,
`completionsAt`, `signatureHelpAt`, `documentOutline`, `assembleForDiagnostics`
and the instruction and directive tables), and for linker configurations
`parseConfig`, `configDiagnostics`, `configHover`, `configCompletions`,
`configDefinition`, `configOutline`, `checkWithLd65` and `clementinaMemoryMap`. Their positions are zero-based lines
and characters, as in LSP.
