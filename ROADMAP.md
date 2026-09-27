# Clementina SDK roadmap

This is the current phase status. **Delivered** means the planned working path
exists; it does not imply that every possible extension or physical-hardware
test is complete. The format and hardware contracts live in `specs/` and
`docs/architecture/`, not in this status summary.

| Phase | Scope | Status | Current result |
| --- | --- | --- | --- |
| 0 | Scaffold | Delivered | SDK workspaces, build, and tests. |
| 1 | Machine specification | Delivered | Versioned developer specs and compatibility record, including the ascending `$04B7` loader and relocatable audio tracks. |
| 2 | Portable projects and assets | Delivered | `clementina.yaml`, versioned schemas, asset validation, cross-reference checks, and Studio conversion. |
| 3 | Shared packages | Delivered | Structured diagnostics, project filesystem APIs, schema/type conformance, asset resolution, and Studio validator migration. |
| 4 | CLI | Delivered | Validation, doctor, BASIC compilation, project build, and owned-emulator run with stable diagnostics and exit codes. |
| 5 | Emulator automation | Delivered | Serialized Go automation, held input, snapshots, execution control, load plans, source stepping, and an SDK client. |
| 6 | Studio integration | Delivered | Portable project open/save, SDK validation, preserved asset paths and identities, and the Builder tab. |
| 7 | Assembly and runtime | Delivered | ca65/ld65 builds, exact source maps, asset files and descriptors, SD output, and the 6502 runtime library. |
| 8 | BASIC | Delivered | ROM-compatible compiler/inspector, portable build/run/debug, and a language server with navigation and editing tools. |
| 9 | Agent workflows | Delivered | Executable BASIC and assembly game starters, coding checks, source-aware debugging, and portable character/OAM inspection, with emulator evidence. |
| 10 | MCP | Delivered | A stdio server exposes shared validation, build, and owned-emulator tools with structured results. |
| 11 | VS Code | Delivered | Thin DAP and BASIC language clients over the editor-neutral debug and language-server packages. |
| 12 | Advanced debugging | Delivered | Bank-selective breakpoints, bounded 65C02 disassembly, and verified call and interrupt frames across the emulator, SDK, and editor clients. |

The [agent workflows](agents/workflows/create-game.md) cover game creation,
coding, character inspection, and debugging through the SDK. The
[MCP server](docs/mcp.md) provides these shared SDK operations to local MCP
hosts. Both paths use the portable project format and emulator automation.

The normal assembly startup already uses BASIC: the generated `BOOT.BAS`
loads assets and hands control to the assembly image through terminal `BLOAD`.
`LOAD "BOOT.BAS"` then `RUN` works on the card and in the emulator. The reserved
`program.kind: mixed` enum is rejected by validation and is not needed for
this path. `SYS` remains available for a loaded routine that returns safely
to BASIC. See [program loading](docs/program-loading.md).

## Phase 12: advanced debugging

1. Define an emulator protocol for breakpoints that distinguish physical RAM
   banks at the same logical CPU address. Carry bank identity through source
   mapping and debugger stop reports, then test execution in two banks at one
   logical address.
2. Add bounded 65C02 disassembly from captured CPU memory and bank state, with
   source locations where the build supplies them. Expose it through the shared
   debugger and the editor adapter.
3. Define which call and interrupt frames can be reconstructed reliably. Expose
   verified frames through the shared debugger and editor adapter; report an
   unknown caller when stack contents cannot establish one. Test nested calls,
   returns, interrupts, and ambiguous stacks in the emulator.

Callers are reported only when observed execution and preserved stack bytes
establish them. The debugger reports an unknown caller below the verified
frames. Disassembly uses the physical bank selected at the stop, and source
breakpoints at one logical address remain distinct across ExRAM banks.

## Defined limits and follow-up work

- Legacy logical CPU breakpoints still match every mapped bank by design;
  source breakpoints with bank metadata use physical bank selection. See
  [debugger integration](docs/debugger.md).
- The [asset runtime](docs/gamedev/builder.md) and
  [runtime demo](examples/runtime-demo/) have emulator integration coverage.
  No physical Pico runtime test or audio signal capture is recorded here.
  Emulator register snapshots validate programmed audio state, not the PWM
  signal produced by a physical board.
- MIA's sequencer guide still says NOTE and REST hold for `dur` samples.
  Firmware and emulator normal playback occupy `dur + 1` samples because
  decoding applies the event before later samples decrement its countdown.
  The SDK song compiler writes the requested duration minus one. Reconcile
  that upstream prose with the implementation before changing event timing.
- ROM `TRACK` emits adjacent notes without a gate-off, so they do not
  retrigger the envelope as the SDK song compiler's non-legato notes do. The
  sequencer has no instantaneous frequency-only opcode for smooth pitch slides.
- CPU placement and linker configuration stay explicit project inputs by
  design. The Builder generates asset includes, descriptors, an SD card folder,
  and `runtime.lib`; it does not choose a game's memory map.
- Scene files are not part of portable format version 1. Define their ownership
  and validation rules before adding them; see [project format](docs/project-format.md).

For implementation details, use [shared packages](docs/shared-packages.md),
[CLI](docs/cli.md), [assembly](docs/assembly.md),
[BASIC tooling](docs/basic-tooling.md), and
[VS Code integration](docs/vscode-extension.md).
