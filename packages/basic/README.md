# @clementina/basic

Tools for Clementina ROM BASIC source, saved programs, PRG files, and portable
load plans. The tokenizer and file formats follow [`specs/basic.json`](../../specs/basic.json)
and [`specs/schema/load-plan.schema.json`](../../specs/schema/load-plan.schema.json).

## Requirements

- Node.js 20 or newer.
- `@clementina/core` 0.2.0, installed with this package.
- Numbered source using printable 7-bit ASCII, at most 71 input characters per
  line, and line numbers from 0 through 63999.

## Use

```sh
npm install @clementina/basic
```

Compile a numbered text program to the raw file accepted by ROM `LOAD`:

```ts
import {compileBasicProgram, detokenizeBasicProgram, inspectBasicProgram} from '@clementina/basic';
import {writeFile} from 'node:fs/promises';

const program = compileBasicProgram('10 PRINT "HELLO"\n20 END\n');
await writeFile('GAME.BAS', program);

console.log(inspectBasicProgram(program).lines.length); // 2
console.log(detokenizeBasicProgram(program)); // canonical numbered source
```

The output has no PRG header. By default its forward links are relocatable;
ROM `LOAD` rebuilds them. Pass `{baseAddress: address}` to
`compileBasicProgram` only when creating an exact in-memory image at a known
TXTTAB address. The SDK does not choose that address.

Inspect or encode a machine-code PRG, and generate editor commands for an
ordered load plan:

```ts
import {checkLoadPlan, encodePrg, inspectPrg, renderLoadPlanLaunch} from '@clementina/basic';

const prg = encodePrg(Uint8Array.of(0x60), 0x6000);
console.log(inspectPrg(prg).payloadLength); // 1

const plan = {
  format: 'clementina-load-plan',
  version: 1,
  steps: [
    {kind: 'mia', path: 'PALETTE.BIN', address: 0x100, length: 256},
    {kind: 'prg', path: 'GAME.PRG', loadAddress: 0x6000, length: 1, runAddress: 0x6000},
  ],
};

if (!checkLoadPlan(plan).ok) throw new Error('Invalid load plan');
console.log(renderLoadPlanLaunch(plan));
// {mode: 'numbered', lines: [...], startCommand: 'RUN'}
```

`renderLoadPlanLaunch` emits numbered bootstrap lines for a terminal PRG and
direct editor commands for a terminal BASIC program. Paths are relative to the
mounted SD root. MIA loads cannot overlap the reserved SD/FS state at
`$13000-$13BFF`. See [program loading](../../docs/program-loading.md) for the
full loading contract and [BASIC tooling](../../docs/basic-tooling.md) for
tokenization and saved-program details.

## Development

Run from the repository root after `npm install`:

```sh
npm run build -w @clementina/basic
npm run typecheck -w @clementina/basic
npm test -w @clementina/basic
```

The package test command builds the package and runs `tests/loading.test.mjs`.
