# Editor debugger integration

`@clementina/debug` is the editor-neutral layer above the assembler/BASIC source
mapping and the transport-independent emulator client. It owns composite debugger behavior so
a VS Code extension or another editor does not have to reproduce breakpoint,
stepping, frame, register, or process-lifecycle rules.

## Session API

`ClementinaDebugSession` exposes one `Clementina 65C02` thread and one current CPU
frame. A snapshot contains the strict execution state, raw numeric registers,
cycle count, MIA pause state, every source location containing PC, and the first
location as the primary editor source position. The single frame is intentional:
the SDK has no verified stack-unwind contract yet.

The session provides:

- replacement-style source breakpoints per path;
- `continue`, `pause`, and `reset`;
- source `stepIn` and `next` plus machine-instruction stepping;
- mapped memory reads;
- bounded stop polling with optional cancellation;
- cleanup of address breakpoints installed by that session.

Breakpoint requests return one result per requested line. Non-emitting lines are
unverified with an explicit message. Addresses shared by several source lines or
files remain installed until no configured source breakpoint needs them. Existing
address breakpoints that were already present are preserved. Banked locations are
reported as logical-only because the current Go breakpoint engine does not compare
physical RAM banks.

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
Stack unwinding, disassembly, physical bank breakpoints, and richer evaluation of
arbitrary BASIC expressions require separate verified contracts.
