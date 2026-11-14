# BASIC tokenizer and saved-program files

`@clementina/basic` compiles portable numbered source into the raw tokenized file
consumed by the ROM's `LOAD` statement. Its tables and limits are recorded in
`specs/basic.json` and are derived from the current Clementina ROM rather than from
another machine's Microsoft BASIC dialect.

```ts
import {
  compileBasicProgram,
  detokenizeBasicProgram,
  inspectBasicProgram,
  parseBasicSource,
  tokenizeBasicLine,
} from '@clementina/basic';

const file = compileBasicProgram(`
10 PRINT "HELLO"
20 END
`);

const info = inspectBasicProgram(file);
const source = detokenizeBasicProgram(file);
```

The file is exactly the byte range that ROM `SAVE` writes from `TXTTAB` through
`VARTAB`. It has no PRG load-address header. Each stored line contains a two-byte
forward link, a little-endian line number, tokenized text, and a zero terminator;
the program ends with two zero bytes.

By default, `compileBasicProgram` writes `$FFFF` into every nonterminal forward
link. This is a deliberate relocatable `LOAD` file: the ROM checks the nonzero
high byte while scanning and then rebuilds every link before returning to
`READY.`. It must pass through `LOAD` before execution. Supply `baseAddress` when
an exact in-memory image with absolute links is required:

```ts
const image = compileBasicProgram(source, {baseAddress: 0x61ac});
inspectBasicProgram(image, {baseAddress: 0x61ac});
```

The SDK does not choose that address. Clementina's `TXTTAB` is the linker-computed
end of the installed ROM image and can move when the ROM changes.

The tokenizer mirrors the ROM behavior:

- source lines use printable 7-bit ASCII, take at most 80 typed characters
  (line number included), and use line numbers 0 through 63999;
- lines are stored in numeric order; a later duplicate replaces an earlier one,
  and a number with no body deletes that line, matching interactive entry;
- spaces after the line number are skipped and later spaces are preserved, while
  letters are folded to uppercase outside quoted strings, `DATA`, and `REM`;
- a quote starts a string even inside `DATA`, so a colon in a quoted `DATA` item
  does not end the statement;
- `?` becomes `PRINT`, and `MON` uses its dedicated `$FE` token;
- extension functions, first-table extensions, second-table extensions, and
  primary tokens are searched in the ROM's order;
- keyword matching has no identifier boundary. For example, the `ON` inside
  `MONEY` is tokenized, as it is on the machine.

The CLI writes the same relocatable format:

```sh
clementina basic compile src/main.bas build/game.bas
```

The output can be copied to the SD card and loaded with `LOAD "build/game.bas"`.
Use a different output path from the source because the compiled file is binary.

## Glyphs and styled strings

On the machine, the screen editor stores each character of a quoted string
with the pen it was typed in (color, flips and reverse), and its glyph modes
(`ESC M`) type tiles outside printable ASCII. Portable source writes both with
`{…}` tags inside quoted strings, `DATA` text and `REM`. Elsewhere a `{` is an
ordinary character. `sourceNotation` in `specs/basic.json` is the contract:

```basic
10 PRINT "{c2 fy}F{c3}r{c4}a{c5}n"
20 PRINT "{c1}{$81}{$82} BOX"
30 REM {$91} glyphs work in remarks too
```

- `{$hh}` stores the byte `$hh`, drawn as charset tile `$hh`. It acts as that byte
  typed, so `{$3A}` ends unquoted `DATA`. `{$00}` ends a tokenized line and `{$22}`
  is the quote, so both are rejected; write a literal `{` as `{$7B}`.
- A style tag sets the attribute of the characters after it. It is only allowed in
  quoted strings. `c0`–`c15` is the palette bank (as `COLOR` and `ESC 0`–`F`
  choose it), `fx` and `fy` the flips (`FLIPX`, `FLIPY`, `ESC H`, `ESC V`), and
  `rev` reverse (`ALT`, `ESC R`). Omitted flags are off and an omitted color is
  `c0`.
- A quoted string with a style tag gets a style-sidecar record for every
  character; characters before its first tag take attribute `$00`. The compiler
  adds BASIC's raw-tile bit to glyphs outside `$20`–`$7E`, as the screen editor
  does. A string with no style tag gets no record and prints at the BASIC pen
  through `CHROUT`, which acts on control codes: `PRINT "{$0D}"` starts a new line,
  while `PRINT "{c0}{$0D}"` draws tile `$0D`.
- The 80-character limit counts typed characters: a character tag counts as one
  and a style tag as none. A line whose styled strings need more than the ROM's
  42 sidecar bytes (4, plus 2 and one per character for each styled string) is an
  error. The screen editor would silently store that line unstyled.

`detokenizeBasicProgram` writes the same notation, so a program saved on the
machine round-trips through a `.bas` file. Every string the editor recorded starts
with its style tag (`"{c0}HELLO"` for text typed in the startup pen), glyph bytes
become `{$hh}`, and recompiling the text gives the same bytes. The inspector checks
that each sidecar record covers one whole quoted string, including one left open
at the end of its line, as the ROM records them. Notation cannot represent an
attribute that breaks the editor's raw-tile rule. One example is the raw-tile bit
on a printable character, after `POKE 770` puts that bit in the pen; detokenizing
such a line throws.

`tokenizeBasicLineWithSpans` returns each line's style records, its typed
`inputLength`, and its `endMode` (the lexical mode after its last character). Its
lexemes mark tags and carry each styled character's attribute. A source error is a
`BasicProgramError` with the physical `sourceLine` and, when it concerns specific
text such as a malformed tag, its `columns`.
