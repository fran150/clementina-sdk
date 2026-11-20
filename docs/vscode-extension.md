# VS Code extension

The `clementina` extension (`packages/vscode-extension`) is a thin protocol/UI
client over editor-neutral SDK layers — it implements no
debugging or language logic of its own:

- **Debugging**: `@clementina/debug-adapter` (`packages/debug-adapter`) is a
  standalone stdio [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)
  server built on `@vscode/debugadapter` (the generic DAP library — editor-agnostic
  despite the package name, the same category of dependency as
  `vscode-languageserver`). It is a pure translation layer over
  `ClementinaDebugSession`/`createProjectDebugSession`
  (see [editor debugger integration](debugger.md)); no debugging behavior lives
  in the adapter itself.
- **BASIC language support**: `@clementina/basic-lsp`'s existing
  `clementina-basic-lsp` server (see [the BASIC language server](basic-lsp.md)),
  registered for `.cbas` files through `vscode-languageclient`. It provides
  diagnostics, hover, contextual completion, symbols/references/rename,
  line-target navigation, signatures, semantic tokens, formatting, and renumbering.
- **Assembly language support**: `@clementina/asm-lsp`'s `clementina-asm-lsp`
  server (see [the assembly language server](asm-lsp.md)), registered for `.s` and
  `.inc` files. It shows ca65's errors and warnings as you type, explains
  instructions (with their addressing modes, opcodes and cycles), directives and
  symbols on hover, completes instructions, macros, symbols and directives, and
  provides go to definition, references, rename, signature help for macros, the
  outline and folding, across the workspace and the Clementina library.
- **Linker configuration support**: the same server handles ld65 linker
  configurations (`link.cfg`, see
  [linker configurations](asm-lsp.md#linker-configurations-linkcfg)): ld65's
  rules and ld65's own errors as you type, warnings where a memory area takes
  memory Clementina's kernel or BASIC uses (from `specs/cpu-memory-map.json` and
  the project's `build.basic.memoryTop`), a `loadAddress` the configuration does
  not start at and segments the sources use that it does not place, hover for
  blocks, attributes, memory areas, segments and addresses, completion, go to
  definition, the outline and folding.
- **Manifest editing**: `clementina.yaml` is checked against
  `specs/schema/project.schema.json` by Red Hat's YAML extension
  (`redhat.vscode-yaml`, an `extensionDependencies` entry, through
  `contributes.yamlValidation`), which gives field completion, hover from the
  schema's `description`s and schema errors. `src/manifest.ts` adds the SDK's
  own checks as you type, `checkManifestText` from `@clementina/project/node`
  (the `loadProject` checks on the unsaved text, placed on the YAML node they
  name; schema errors are left to the YAML extension except an out-of-range
  hex address), and completion of project files in path fields
  (`manifestPathFieldAt`, `manifestPathCandidates`).

`packages/vscode-extension/src/extension.ts` is the entire integration: it
registers a `DebugAdapterDescriptorFactory` that spawns
`clementina-debug-adapter` and `LanguageClient`s that spawn
`clementina-basic-lsp` and `clementina-asm-lsp`, all spawned through
`process.execPath` for cross-platform reliability. The build bundles the
extension and the three servers, copies the project schema to
`dist/project.schema.json`,
with their SDK dependencies, into `dist/` (`scripts/bundle.mjs`, using
esbuild), so the `.vsix` needs no `node_modules` and no separate SDK install;
the servers always match the extension's version. Only the emulator is
external.

## Capabilities

Matching `@clementina/debug`'s actual capabilities exactly — nothing invented:

- Launch (build the project and start an owned emulator via
  `createProjectDebugSession`), source breakpoints, continue/pause,
  step-in/step-over, and restart (reset, then load and start the project again).
  `F5` works without a `launch.json`: it debugs the open folder.
- By default the session runs the game in real time in
  `clementina-emulator --headless --control` and opens `clementina-video-client`,
  where you see and play it while VS Code stops it at breakpoints. The status bar
  shows the target and measured speed; clicking it (or **Clementina: Set Emulator
  Speed…**) picks 1, 1.2, 2, 4 or 8 MHz or unthrottled. Launch attributes `realtime`
  (`false` for the screenless automation emulator), `speed`, `videoClient`,
  `emulator` and `stopOnBankSwitch` (stop, with "Bank switch" as the reason, just
  before code at `$8000-$BFFF` stores to `VIA_ORA`); settings `clementina.debug.speed` (empty by default: the project's `target.phi2Hz`, 1.2 MHz when unset),
  `clementina.debug.openVideoClient`, `clementina.debug.emulatorPath` and
  `clementina.debug.videoClientPath`. Empty paths use the tools `clementina
  install` put in `~/.clementina/bin`, then `PATH`.
- Projects with BASIC and assembly debug both at once: breakpoints in `.cbas` and
  `.s` files stop, and the call stack shows the BASIC line under the routine.
- Verified stack frames for assembly projects, with an explicit unknown caller
  boundary, and a read-only **Registers** scope
  (PC/bank/A/X/Y/SP/P/cycles/MIA-paused) sourced directly from `DebugRegisters`.
- Assembly projects use ld65 source maps. BASIC projects use the ROM statement
  boundary and current-line state for source breakpoints and line stepping, plus a
  **BASIC Variables** scope and simple-variable hover/watch evaluation.
  Hover and watch also take registers and assembly labels and constants
  (`hello`, `KERN_CHROUT`).
- `.cbas` files have a TextMate grammar and language configuration, and the
  **Clementina BASIC: Renumber Program…** command prompts for start and step.
- `link.cfg` (also `linker.cfg`, `ld65.cfg` and `*.ld65`) opens as **ld65 Linker
  Configuration**, with a TextMate grammar (`syntaxes/clementina-ld65.tmLanguage.json`)
  and a language configuration (`#` comments, `{}` folding). A `.cfg` file that a
  project's `build.assembly.linkerConfig` names opens as one too, whatever its
  name. `clementina.assembly.ld65Path` sets the ld65 that checks it (empty: the
  one `clementina install` installed, then `PATH`), and
  `clementina.assembly.diagnostics` also says when ld65 runs; the server's own
  checks always run.
- `.s` and `.inc` files open as **Clementina Assembly** (ca65 syntax for the
  W65C02S, including the Rockwell bit instructions and `WAI`/`STP`), with a
  TextMate grammar and a language configuration (`;` comments, folding of
  `.proc`/`.scope`/`.macro`/`.if` blocks). The grammar also highlights the
  symbols the SDK's public includes define: the Clementina library's macros, routines
  and zero-page arguments from `clementina-lib.inc`, and the constants that
  `generate-includes.mjs` writes into `clementina.inc` and `mia.inc` from
  `specs/*.json`. It is generated from those files by
  `scripts/generate-asm-grammar.mjs` (`npm run generate:asm-grammar`), and
  `npm test` fails if it is stale. The assembly language server adds the rest
  (see above).
- Two settings control the assembly checks: `clementina.assembly.ca65Path` (empty:
  the ca65 `clementina install` installed, then `PATH`) and
  `clementina.assembly.diagnostics` (`onType`, `onSave` or `off`). The extension
  passes its global storage folder as the server's `libraryDirectory`, so go to
  definition opens the library's sources there.
- Both languages contribute `breakpoints`, so source breakpoints can be set
  from the gutter in `.cbas`, `.s` and `.inc` files; the debugger resolves
  assembly breakpoints through the ld65 source map.

## Glyphs and styled strings

The extension draws the language server's view of
[glyph and style tags](basic-tooling.md#glyphs-and-styled-strings):

- Tags are dimmed, so the text around them reads first. The **Clementina
  Screen** panel (below) shows how strings print.
- Typing `{` in a string closes the tag and opens completion. It lists every
  glyph, with its picture in the item details, and in a quoted string the colors
  (with swatches) and the `fx`, `fy` and `rev` flags. Hovering a tag or a styled
  string shows it enlarged.
- **Clementina BASIC: Insert Glyph…** picks a tile from a list showing every glyph
  and inserts its `{$hh}` tag. **Clementina BASIC: Style Selected Text…** picks a
  color and flags, or removing all styles, for the selected characters, or for
  the string under the cursor. Both are also on the editor's context menu.

## Screen preview

The **Clementina Screen** tab in the bottom panel shows what lines print, drawn
with the default charset and palette. It follows the active BASIC editor:

- With the cursor on a line and nothing selected, it shows that line, including
  every statement after a `:`.
- With a selection, it shows every line the selection touches, in source order.
  A selection that ends at the start of a line leaves that line out. With
  several cursors or selections, it shows all the lines they touch.
- The header names the lines (`Line 100`, `Lines 20–30`). Moving to the terminal
  or to another kind of file keeps the last preview, and nothing is computed
  while the tab is hidden.

**Clementina BASIC: Show Screen Preview**, in the command palette and the
editor's context menu, opens the tab and leaves the focus in the editor.

Each preview starts from a cleared screen in the startup pens and runs the
lines' `PRINT`, `CLS`, `CRSR`, `COLOR`, `FLIPX`, `FLIPY`, `ALT`, `STYLE` and
`BCOLOR` statements the way the ROM does:

- A comma moves to the next 14-column zone, `TAB(` and `SPC(` print spaces, and a
  `PRINT` that ends in `;`, `,`, `TAB(` or `SPC(` keeps the cursor on the line.
- A number gets a sign before it (a space when positive) and a space after it.
- Numbers and unstyled strings print in the BASIC pen, and control codes such as
  `{$0D}` in them act. Styled strings print every character as a glyph in its
  own style, except for the fields `STYLE` takes from the pen.
- Output wraps at column 40 without ending the BASIC line, so comma zones and
  `TAB(` keep counting from where the line started, and the screen scrolls
  after row 25.

Control flow is ignored: a `PRINT` after `THEN` always runs, and `GOTO` does not
jump. `INPUT` prompts are not drawn. A value only the running program knows,
such as a variable, an expression or `CHR$(…)`, prints as its source text in a
dashed box, with a number's spaces around it. A statement whose argument is not
a constant, or is out of range, is skipped, and a note below the screen says so.

The extension only paints what the server returns and forwards the pickers'
choices to it, so all notation and layout rules stay in `@clementina/basic` and
`@clementina/basic-lsp`.

Launch configuration:

```json
{
  "type": "clementina",
  "request": "launch",
  "name": "Launch Clementina project",
  "program": "${workspaceFolder}",
  "emulator": "/path/to/clementina-automation",
  "port": 0
}
```

`program` is the portable project root (containing `clementina.yaml`).
`emulator`/`port` are optional host-only settings, defaulting to
`clementina-automation` on `PATH` and an automatic loopback port — the same
defaults as CLI `run` (see [the CLI](cli.md)).

Assembly debugging also provides physical bank-selective source breakpoints,
bounded disassembly, and verified JSR/interrupt stack frames. An explicit
“Unknown caller” frame marks the limit of observed execution. Reverse
disassembly is unavailable because instruction boundaries before a given PC
cannot always be established. Arbitrary BASIC expression evaluation is not
supported; see [editor debugger integration](debugger.md).

## Trying it

This is not published to the Marketplace. Build the SDK (`npm run build`),
then either:

- Open `packages/vscode-extension` in VS Code and press `F5` to launch an
  Extension Development Host, or
- Package it with `npm run package` (from `packages/vscode-extension`) and
  install the resulting `build/clementina-<version>.vsix` with `code --install-extension`. The script
  runs `vsce package --no-dependencies`: vsce cannot collect dependencies from
  an npm workspace, and the bundle already contains them.
