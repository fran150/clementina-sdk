# @clementina/emulator-client

TypeScript client for the Clementina headless emulator's version 1 automation API. It validates requests and responses, controls execution, reads machine state, and composes source breakpoints and stepping with an assembler source map. The main entry works with a caller-supplied transport or HTTP `fetch`; the separate `/node` entry starts and owns a local emulator process.

## Requirements

- Node.js 20 or newer for the `/node` entry and package development.
- A compatible `clementina-automation` executable from the Clementina emulator repository for process launching, or an already running version 1 automation HTTP endpoint.
- An existing SD root directory for `startEmulatorProcess`. Mount the generated build output there before using `launchLoadPlan`.
- Query `capabilities().methods` when using an older version 1 server; execution-control methods are optional in older server builds.

The protocol and its limits are recorded in [`specs/emulator-automation.json`](../../specs/emulator-automation.json). See [emulator automation](../../docs/emulator-automation.md) for execution semantics and [program loading](../../docs/program-loading.md) for load plans.

## Connect to an existing endpoint

```ts
import {createHttpEmulatorClient} from '@clementina/emulator-client';

const client = createHttpEmulatorClient('http://127.0.0.1:12345/v1');
const capabilities = await client.capabilities();
await client.reset();
await client.step(4_000_000); // cycle budget; ROM readiness is not guaranteed
await client.input([65, 13]); // raw console bytes, including Return
const state = await client.state();
const bytes = await client.readMemory(0x6000, 16);
```

The optional second argument to `createHttpEmulatorClient` is a caller-owned `fetch` implementation. You can also construct `new EmulatorClient(async request => response)` for another transport. Calls are not retried: a lost reply can follow a completed mutation. `readMemory` returns `null` for unsupported side-effect-free peeks. Cycle counts are decimal strings.

## Start an owned process in Node.js

```ts
import {startEmulatorProcess} from '@clementina/emulator-client/node';

const emulator = await startEmulatorProcess({
  executable: '/path/to/clementina-automation',
  sdRoot: '/path/to/generated-build-output',
});
try {
  console.log(await emulator.client.capabilities());
  // await emulator.client.launchLoadPlan(plan);
} finally {
  await emulator.close();
}
```

The process prints its loopback `/v1` endpoint, which the client validates before checking capabilities. `close()` is idempotent. `launchLoadPlan` sends the rendered BASIC commands through the ROM input path; its boot and input cycle options are bounded processing budgets.

## Debug operations

```ts
import {createAssemblySourceMap} from '@clementina/assembler';

const sourceMap = createAssemblySourceMap(build.debug, {bank: build.loadStep.bank});
await client.addSourceBreakpoint(sourceMap, 'src/main.s', 12);
const next = await client.stepSource(sourceMap);
const afterCall = await client.stepOverSource(sourceMap, {maxInstructions: 10_000});
await client.removeSourceBreakpoint(sourceMap, 'src/main.s', 12);
```

`client` and `build` in this example come from the connection and assembly build steps. Source resolution uses exact emitted locations; an empty line raises `SourceBreakpointError`. Source stepping needs a stopped machine at an instruction boundary. Logical breakpoints match every bank, while bank breakpoints pair an address in `$8000-$BFFF` with a physical bank. `stepInstruction` and source stepping use cycle budgets and ignore address breakpoints.

## Development

From the repository root, after `npm install`:

```sh
npm run build -w @clementina/emulator-client
npm run typecheck -w @clementina/emulator-client
node --test tests/emulator.test.mjs tests/emulator-process.test.mjs
```

Build before running the tests because they import the package's generated `dist` files. The root `npm test` runs the full SDK verification suite.
