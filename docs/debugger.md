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
  realtime: {speedMhz: 1.2}, // omit to use the unthrottled clementina-automation
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

Preparation builds the portable project, starts an owned emulator process with
the build's card folder mounted as SD storage, and creates the ld65 source map.
With `realtime` it starts `clementina-emulator --headless --control --paused`,
which runs the game in real time with video and input for the video client;
without it, the unthrottled `clementina-automation`. Both are looked up in
`~/.clementina/bin` first, then `PATH`, unless `executable` names one.
`runtime.client` is the emulator client, for controls such as `setSpeed`. It
does not start project execution. This permits editor initialization and breakpoint
configuration before `launch` enters the BASIC bootstrap. `close` is idempotent and
removes session-owned breakpoints before stopping the process.

For an assembly project, `createProjectDebugSession` creates the exact ld65 source
map described above. With `build.assembly.banks` each banked segment's lines map
to `{address, bank}` for their own bank (the build's `segmentBanks`), so a
breakpoint in bank 2's code stops only while bank 2 is mapped, and the session
follows the bank the emulator reports. The option `stopOnBankSwitch` puts a bank
breakpoint on each absolute `STA`/`STX`/`STY`/`STZ` to VIA Port A in code linked at
`$8000-$BFFF` (`bankSwitchStops`, listed in `runtime.bankSwitchStops`), so the
session stops just before banked code switches the bank under itself. For a BASIC project it reads the entry source and creates a
`ClementinaBasicDebugSession`. For a project with both, as every `clementina new`
project has, it creates a `ClementinaProjectDebugSession` that combines the two:
breakpoints in `.cbas` files go to the BASIC session and the rest to the assembly
one, a stop is shown in assembly while the program counter is in a mapped routine
and in BASIC otherwise, the call stack ends with the BASIC line that called the
routine, and stepping past a routine's `RTS` carries on to the next BASIC
statement. The BASIC session puts a breakpoint where the ROM's `NEWSTT`
starts a new numbered line: `CURLIN` already holds the new line and none of its
statements has run, so a breakpoint on a line stops before that line. Stops are
filtered by the little-endian `CURLIN` value; both addresses are recorded in
`specs/basic.json`. The hook runs once per line, so a line with several
statements (`A=1:B=2`, or `IF ... THEN ...`) stops once, before its first
statement, and a step runs the whole line. A `RETURN` to the middle of a line
carries on to the next line start. When the emulator supports
`setBreakpointFilter`, the filter runs in the emulator, so the game keeps its
speed between requested lines; it is lifted while a line step needs the next
line start, whichever line it is. Breakpoint paths may be absolute or project-relative. This provides effective numbered-line
breakpoints and line stepping without pretending that BASIC has one machine-code
address per source line. It also decodes live simple numeric, integer, and string
variables from the ROM variable table and supports variable lookup for DAP hover
and watch evaluation.

The assembly session evaluates registers (`A`, `X`, `Y`, `SP`, `P` with its
flags, `PC`) and ld65 debug-info symbols: a label shows its address and the
first eight bytes there, a constant (such as `KERN_CHROUT` from
`clementina.inc`) its value. A cheap local like `@next` is the one at or
below the program counter. The combined session tries the hovered file's
language first (the adapter passes it from the DAP `source`), so `A` is the
register in a `.s` file and the variable in a `.cbas` file; in BASIC a
register name never falls through to the register.
While a BASIC source step waits for the next statement boundary, `pause()` can
interrupt it. The wait uses a host-side 30-second default timeout and 10 ms poll
interval; direct SDK callers may set `timeoutMs` and `pollIntervalMs` for a step.

This package is not a Debug Adapter Protocol server and does not import VS Code.
`@clementina/debug-adapter` is that translation (see
[the VS Code extension](vscode-extension.md)), over this same session API.
Evaluation of arbitrary BASIC expressions is not supported.
