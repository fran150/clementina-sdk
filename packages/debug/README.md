# @clementina/debug

Editor-neutral debugging for Clementina assembly and BASIC programs. The package
maps emulator execution to source lines, owns source breakpoints, provides CPU
frames and registers, and coordinates stepping, memory reads, and stop polling.
The main entry works with a supplied emulator client and source map. The Node.js
entry builds a portable project and manages an emulator process.

## Requirements

- Node.js 20 or newer.
- A Clementina emulator with the version 1 automation API for a live session.
- For `@clementina/debug/node`, a project with `clementina.yaml` and an emulator
  automation executable. Assembly projects also need `ca65` and `ld65` from cc65.

The Node entry returns build and startup failures as diagnostics. A prepared
project remains stopped until `launch()` is called, so breakpoints can be set
first. Always call `close()` to release the process.

## Debug a project

```ts
import {createProjectDebugSession} from '@clementina/debug/node';

const prepared = await createProjectDebugSession('/projects/my-game', {
  executable: '/path/to/clementina-automation',
});
if (!prepared.ok) {
  console.error(prepared.diagnostics);
} else {
  const runtime = prepared.value;
  try {
    await runtime.session.setSourceBreakpoints('src/main.s', [12, 24]);
    await runtime.launch();
    const stopped = await runtime.session.waitForStop({timeoutMs: 30_000});
    console.log(stopped.frame, stopped.registers);
  } finally {
    await runtime.close();
  }
}
```

For BASIC projects, pass physical file line numbers to `setSourceBreakpoints`.
The BASIC session resolves effective numbered lines and filters stops at the ROM
statement hook using `CURLIN`. It also offers `variables()` and simple variable
lookup through `evaluate(name)`. Assembly sessions use ld65 source maps, support
bank-selective breakpoints, verified caller frames, and `disassemble()`.

## Use the core directly

Pass an `EmulatorClient` and any `SourceMapResolver` to
`ClementinaDebugSession`. For assembly, `createAssemblySourceMap` provides the
resolver from ld65 debug information:

```ts
import {createAssemblySourceMap, type Ca65DebugInfo} from '@clementina/assembler';
import {ClementinaDebugSession} from '@clementina/debug';
import {createHttpEmulatorClient} from '@clementina/emulator-client';

async function inspect(debugInfo: Ca65DebugInfo): Promise<void> {
  const client = createHttpEmulatorClient('http://127.0.0.1:1234/v1');
  const sourceMap = createAssemblySourceMap(debugInfo, {bank: 2});
  const session = new ClementinaDebugSession(client, sourceMap, {bank: 2});
  try {
    await session.setSourceBreakpoints('src/main.s', [12]);
    const snapshot = await session.snapshot();
    console.log(snapshot.frame);
  } finally {
    await session.dispose();
  }
}
```

`debugInfo` above is the parsed ld65 debug data returned by the assembly build.
The client must connect to a running emulator. Source breakpoints are replaced
per path; addresses already owned by another client are preserved. `waitForStop`
accepts a host timeout, polling interval, and optional abort signal. Source
stepping accepts instruction budgets; the BASIC session also accepts host wait
limits. These are orchestration limits, not emulated CPU timing.

`decodeInstructions(address, bytes, count)` can decode up to 64 W65C02S
instructions from an already captured byte range without a live session.

## Development

From the SDK workspace root:

```sh
npm run build -w @clementina/debug
npm run typecheck -w @clementina/debug
node --test tests/debug.test.mjs
```

The workspace `npm test` also runs debugger-adapter and project integration
coverage. Hardware and automation contracts live in `specs/machine.json`,
`specs/basic.json`, and `specs/emulator-automation.json`.
