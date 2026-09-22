# Emulator automation baseline

`@clementina/emulator-client` talks to the Go headless automation command in
`../clementina-6502`. It has no Studio dependency. The reusable Go `Automation`
session owns its computer exclusively and serializes all calls and cleanup.
It does not attach to a running terminal emulator or share its pause flag.
The protocol is recorded in `specs/emulator-automation.json`.

Build and start from the emulator repository:

```sh
go build -o /tmp/clementina-automation ./cmd/clementina-automation
/tmp/clementina-automation -sd /path/to/generated-build-output
```

The command prints its endpoint once (an automatically chosen loopback port by
default). `-port` selects an explicit port. Stop the process to dispose of the
session. `-sd` mounts an existing host directory for ROM filesystem operations;
omitting it leaves the SD slot empty. No UDP services or serial input are enabled. This is a trusted
local tooling endpoint with no authentication; it rejects browser Origin headers
and mismatched Host headers. HTTP requests use POST `/v1` with one JSON object.
Protocol errors return `{version:1,ok:false,error:string}`; HTTP access errors use
HTTP status codes. Error strings are for people, not stable diagnostic codes.

Node tools can own this lifecycle through the separate
`@clementina/emulator-client/node` entry point:

```ts
import {startEmulatorProcess} from '@clementina/emulator-client/node';

const emulator = await startEmulatorProcess({
  executable: '/path/to/clementina-automation',
  sdRoot: '/path/to/project',
});
try {
  await emulator.client.launchLoadPlan(plan);
  console.log(emulator.endpoint);
} finally {
  await emulator.close();
}
```

The adapter launches without a shell, requires an existing SD directory, accepts
only the expected loopback `/v1` endpoint, verifies `capabilities`, captures a
bounded stderr tail for startup failures, and provides idempotent termination.
The browser-compatible package entry remains free of Node process APIs.

```ts
import {createHttpEmulatorClient} from '@clementina/emulator-client';
const client = createHttpEmulatorClient('http://127.0.0.1:PORT/v1');
await client.capabilities();
await client.reset();
await client.step(4_000_000);
await client.input([65, 13]); // raw console bytes, not Unicode
const state = await client.state();
const bytes = await client.readMemory(0, 256);
const video = await client.video();
```

The boot cycle count above is a test budget, not a readiness guarantee. Requests
are never retried automatically. A transport failure may occur after a mutation
completed. Supply a custom fetch implementation for cancellation/timeouts; aborting
HTTP does not roll back or necessarily stop a bounded Go operation. Await dependent
calls. Concurrent calls are serialized by the server, but their order is unspecified.
`EmulatorClient` also accepts a transport callback for other hosts.

`reset` follows the upstream headless harness: three cycles with reset asserted,
then release. It does not clear all RAM, recreate the machine, wait for BASIC, or
zero the cycle counter. `step` advances complete Tick/PostTick cycles and stops
when MIA requests execution pause. `paused` describes that MIA state, not whether
a request is currently executing. Background execution starts only through `run`
or `resume`. Cycle counts are decimal strings to preserve uint64 precision. Timing retains upstream
host wall-clock semantics; cycle stepping does not provide deterministic replay.

Memory reads use the existing mapped peek, including the selected external-RAM
bank. Unsupported I/O peeks return `null`, never a fabricated zero. The upstream
MIA peek currently mirrors its register window throughout the high CPU region;
this is emulator behavior, not a hardware guarantee for reserved `$E000-$FFDF`.
Text bytes pass through `DebugQueueInput`; source-mode and existing FIFO overflow
semantics still apply. A successful call means injection, not ROM consumption.
No runtime memory allocation is added. The former sequencer/SD MIA-RAM overlap is
resolved; see `docs/compatibility.md`.

Video snapshots contain the complete 68,944-byte MIA video region at one serialized
machine boundary. The video client's new public Go `pkg/render.Snapshot` API calls
its existing compositor and returns a native 320×200 image. Its `clementina-render`
command accepts the JSON byte array on stdin and emits PNG on stdout. There is no
second SDK compositor or dependency from core/assets/project onto rendering.

Cross-repository verification:

```sh
# In clementina-video-client:
go test ./internal/render ./pkg/render
go build -o /tmp/clementina-render ./cmd/clementina-render
# In clementina-6502:
go test -race ./pkg/computers/clementina -run '^TestAutomation'
# In clementina-sdk, after npm run build:
node scripts/test-emulator-integration.mjs /tmp/clementina-automation /tmp/clementina-render
```

The integration check boots the real emulator, generates and enters a BASIC
bootstrap, loads a PRG and MIA asset from the mounted SD directory, stops at a
pre-instruction breakpoint, source-steps over a real JSR/RTS pair, checks memory,
and renders through the existing Go compositor. SDK unit tests run without sibling
checkouts. Held HID/gamepad injection remains future work; source mapping is covered
below.
Process lifecycle and CLI `run` now use the public Node adapter. This is the Phase 5
baseline, not completion of every debugger capability.

The load-plan and launch contract is documented in [program loading](program-loading.md).

## Execution control and breakpoints

The server advertises `run`, `pause`, `resume`, `stepInstruction`, `addBreakpoint`,
`removeBreakpoint`, `breakpoints`, and `clearBreakpoints` in `capabilities().methods`.
The client validates their responses as `ExecutionState`. The general state type
retains optional execution fields to support earlier v1 servers; query capabilities
before using new methods against an older server.

```ts
await client.addBreakpoint(entryAddress); // caller's verified CPU address
await client.run();                       // returns immediately
// Poll client.state() until running is false; stopReason explains why.
await client.stepInstruction(10000);      // maximum cycle budget, not instruction count
await client.resume();                   // continue past a just-hit breakpoint
await client.pause();                    // returns after CPU execution has stopped
```

The background runner is unthrottled and releases its machine lock every 256
cycles. It does not promise the requested hardware PHI2 rate. Inspection and input
share that lock; each response is coherent, but successive reads can observe
different cycles. Pause first when multiple reads must describe one fixed state.
`pause` stops at a full cycle boundary, which may be inside an instruction.
`reset` stops execution and preserves breakpoints. Closing a Go session joins its
runner; concurrent closes are safe.

Breakpoints refer to logical CPU addresses (including the currently selected RAM
bank), not physical RAM offsets. They stop **before** opcode fetch. Operand reads
and reset/interrupt entry do not trigger them. Adding an existing breakpoint or
removing a missing one is idempotent; lists are unique and keep insertion order.
`run` at a breakpoint stops there again. `resume` skips that boundary once only
when continuing from a breakpoint stop, so a loop can hit the same address again.
Manual cycle/instruction steps ignore address breakpoints and require the runner
to be stopped.

Source breakpoints compose the assembler source map with this same address API:

```ts
import {createAssemblySourceMap} from '@clementina/assembler';

const sourceMap = createAssemblySourceMap(build.debug, {bank: build.loadStep.bank});
await client.addSourceBreakpoint(sourceMap, 'src/main.s', 12);
await client.removeSourceBreakpoint(sourceMap, 'src/main.s', 12);
```

Resolution is exact. A line that emitted no bytes raises `SourceBreakpointError`;
the SDK does not move it to a nearby line. A line with disjoint spans installs one
address breakpoint at each span start. The result reports the resolved addresses,
whether their source metadata is banked, and the emulator's complete breakpoint
list. Adding or removing several span starts uses the protocol's individual
idempotent mutations, so a transport failure can leave a prefix applied.
The server stores address breakpoints rather than source-breakpoint identities;
removing a source breakpoint also removes any manually added breakpoint at the same
address.

The Go engine still compares only the logical 16-bit CPU address. For a source
location in `$8000-$BFFF`, `banked: true` reports that the map knows the build bank;
it does not make the address breakpoint bank-selective. It can therefore stop at
the same logical address while another RAM bank is selected. A future physical
bank breakpoint requires an explicit emulator protocol change.

`stepInstruction(maxCycles = 10000)` advances to the next opcode boundary. From
inside an instruction it finishes that instruction; during reset or interrupt entry
it advances to the next opcode fetch. It reports `cycle-limit` if the cycle budget
is exhausted, including a CPU waiting without an interrupt. `STP` reports
`cpu-stopped`; resume cannot release it. Reset is required. This is machine
instruction stepping.

## Source stepping

The transport-independent client composes instruction stepping with an
`AssemblySourceMap`:

```ts
const nextLine = await client.stepSource(sourceMap);
const afterCall = await client.stepOverSource(sourceMap, {
  maxInstructions: 10_000,
  maxCyclesPerInstruction: 10_000,
  bank: build.loadStep.bank,
});
```

Both operations require a stopped machine at an instruction boundary. A source
position is the sorted set of every `path:line` mapping that contains the current
PC; this preserves ld65 macro/include aliases. `stepSource` executes at least one
instruction and stops when that exact set changes. When the starting or resulting
PC is not mapped, it performs one machine step and reports `unmapped` instead of
guessing a nearby source line.

`stepOverSource` uses the Clementina emulator's implemented `$20` three-byte `JSR`.
For that opcode it instruction-steps until both the caller's stack pointer and the
wrapped `PC + 3` return address are restored, then applies the same source-location
rule. Other opcodes behave like `stepSource`. The result reports instruction count,
starting/current locations, whether a call was stepped over, and one of
`source-location`, `unmapped`, `instruction-limit`, `cycle-limit`, `mia-paused`,
`cpu-stopped`, or `stopped`.

The two limits are SDK safety budgets, not hardware timing. Source stepping uses
the protocol's explicit `stepInstruction`, so address breakpoints are ignored just
as they are for direct instruction stepping. Step-over does not promise to finish
a subroutine that never returns normally; it reports `instruction-limit`. It also
does not infer a call for jumps, interrupts, stack tricks, or unsupported opcodes.

State includes `running`, `instructionBoundary`, and `stopReason`:
`initial`, `running`, `pause`, `reset`, `breakpoint`, `instruction`, `cycle-limit`,
`mia-paused`, or `cpu-stopped`. The existing `paused` field continues to mean MIA
execution pause. `resume` clears that flag through the existing MIA host-resume
path; this does not invent a CPU-visible resume command.

Upstream caveat: the current computer wiring shares VCC with CPU RDY and NMI, while
CPU WAI emulation drives RDY low. This can wake WAI through NMI. The bounded-wait
test isolates these control lines as the CPU test harness does; automation does
not alter the board wiring or claim to fix its WAI behavior.
