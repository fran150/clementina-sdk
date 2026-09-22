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

- source lines use printable 7-bit ASCII, contain at most 71 characters, and use
  line numbers 0 through 63999;
- lines are stored in numeric order; a later duplicate replaces an earlier one,
  and a number with no body deletes that line, matching interactive entry;
- spaces after the line number are skipped and later spaces are preserved, while
  letters are folded to uppercase outside quoted strings, `DATA`, and `REM`;
- `?` becomes `PRINT`, and `MON` uses its dedicated `$FE` token;
- extension functions, first-table extensions, second-table extensions, and
  primary tokens are searched in the ROM's order;
- keyword matching has no identifier boundary. For example, the `ON` inside
  `MONEY` is tokenized, as it is on the machine.

Clementina can attach screen attributes to quoted literals with its `$CE,$FF`
style sidecar. The inspector validates and reports existing sidecar records.
Portable text compilation emits unstyled lines because a plain source file has no
per-cell screen attributes; it does not invent them.

The CLI writes the same relocatable format:

```sh
clementina basic compile src/main.bas build/game.bas
```

The output can be copied to the SD card and loaded with `LOAD "build/game.bas"`.
Use a different output path from the source because the compiled file is binary.
