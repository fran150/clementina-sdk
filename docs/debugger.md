# Editor debugger integration

`@clementina/debug` is the editor-neutral layer above the assembler/BASIC source
mapping and the transport-independent emulator client. It owns composite debugger behavior so
a VS Code extension or another editor does not have to reproduce breakpoint,
stepping, frame, register, or process-lifecycle rules.

## Session API

`ClementinaDebugSession` exposes one `Clementina 65C02` thread. A snapshot
contains the current CPU frame, strict execution state, raw numeric registers,
cycle count, MIA pause state, and source locations selected by the physical RAM
bank at the stop. `stackTrace()` adds callers verified from observed JSR or
interrupt execution and preserved stack bytes. It reports `unknownCaller` below
the verified frames; arbitrary stack bytes are never interpreted as a caller.

The session provides:

- replacement-style source breakpoints per path;
- `continue`, `pause`, and `reset`;
- source `stepIn` and `next` plus machine-instruction stepping;
- mapped memory reads;
- bounded disassembly of up to 64 W65C02S instructions from stopped CPU memory,
  with source locations and optional explicit physical bank selection;
- verified call and interrupt frames for a stopped assembly session;
- bounded stop polling with optional cancellation;
- cleanup of address breakpoints installed by that session.

Breakpoint requests return one result per requested line. Non-emitting lines are
unverified with an explicit message. Addresses shared by several source lines or
files remain installed until no configured source breakpoint needs them. Existing
address breakpoints that were already present are preserved. Banked source
locations use `{address, bank}` breakpoints and remain distinct even when they
share a logical CPU address. The legacy address breakpoint API still matches
every mapped bank.

The session serializes editor commands, while `waitForStop` remains outside that
queue so `pause` can interrupt a running wait. Its timeout and polling interval are
host orchestration policy, not emulated timing. Consumers should route breakpoint
mutations through the session; concurrent direct mutation through the underlying
client cannot provide cross-client ownership guarantees.

## Node project composition

`@clementina/debug/node` composes the existing project builder, emulator process,
source map, and session:

```ts
import {createProjectDebugSession} from '@clementina/debug/node';

const prepared = await createProjectDebugSession('/projects/my-game', {
  executable: '/path/to/clementina-automation',
});
if (!prepared.ok) {
  console.error(prepared.diagnostics);
} else {
  const runtime = prepared.value;
  await runtime.session.setSourceBreakpoints('src/main.s', [12, 24]);
  await runtime.launch();
  const stopped = await runtime.session.waitForStop({timeoutMs: 30_000});
  console.log(stopped.frame, stopped.registers);
  await runtime.close();
}
```

Preparation builds the portable project, starts an owned Go automation process
with the project root mounted as SD storage, and creates the ld65 source map. It
does not start project execution. This permits editor initialization and breakpoint
configuration before `launch` enters the BASIC bootstrap. `close` is idempotent and
removes session-owned breakpoints before stopping the process.

For an assembly project, `createProjectDebugSession` creates the exact ld65 source
map described above. For a BASIC project it reads the entry source and creates a
`ClementinaBasicDebugSession`. That session installs the ROM `NEWSTT2` statement
boundary breakpoint and filters stops with the little-endian `CURLIN` value, whose
addresses are recorded in `specs/basic.json`. This provides effective numbered-line
breakpoints and line stepping without pretending that BASIC has one machine-code
address per source line. It also decodes live simple numeric, integer, and string
variables from the ROM variable table and supports variable lookup for DAP hover
and watch evaluation.

This package is not a Debug Adapter Protocol server and does not import VS Code.
`@clementina/debug-adapter` is that translation (see
[the VS Code extension](vscode-extension.md)), over this same session API.
Evaluation of arbitrary BASIC expressions is not supported.
