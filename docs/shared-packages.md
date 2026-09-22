# Shared packages

`@clementina/core` provides `ClementinaDiagnostic`, `ValidationResult<T>`,
`ValidationError`, and schema validation. Diagnostics have a stable code, severity,
message, optional source filename, and JSON Pointer `path`. Messages are for people;
consumers should branch on codes. `check*` APIs accept untrusted JSON and return a
result; existing `validate*` APIs throw `ValidationError` for compatibility.

`@clementina/assets` exports portable models, `checkAsset(value, kind?)`, and
`checkAssetSet(value)`. Schemas enforce structure without coercing or removing data.
Semantic validation adds composition bounds, uniqueness, and cross-asset references.
Reference checking follows successful structural validation to avoid cascading errors.
IDs are case-sensitive and scoped by asset kind; names are unique ignoring case.
The package also emits the specified runtime bytes for an individual RGB565 palette,
a resolved 16-bank palette configuration, and a planar 6 KiB CHR tileset. CHR bank
addresses require an explicit bank number. Shape and animation files remain authoring
contracts because no runtime binary ABI for them has been specified.

`@clementina/project` is browser-compatible and exports manifest validation,
`checkProject`, `createAssetResolver`, and Studio v2 conversion. Resolver entries
pair assets with manifest paths by array index. Recreate a resolver after modifying
project arrays or identities. Unknown explicit Studio tileset references are errors;
a missing reference may resolve to the sole tileset for legacy compatibility.

Node filesystem APIs are exported separately from `@clementina/project/node`:

```ts
import {loadProject, saveProject} from '@clementina/project/node';
const loaded = await loadProject('/path/to/game');
if (loaded.ok) await saveProject('/path/to/game', loaded.value);
else console.error(loaded.diagnostics);
```

Loading parses `clementina.yaml`, validates every listed asset and cross-reference,
and checks that program sources exist as regular files. Saving validates the entire
project and all destinations first, creates parent directories, then writes each
asset through an exclusive temporary file and rename; the manifest is written last.
It does not create, copy, or delete program sources or remove unlisted old assets.
Callers creating a new project must supply program sources themselves.

Paths are relative POSIX paths. Traversal, control characters, duplicate asset paths,
source/manifest collisions, and file/directory collisions are rejected. Symlinks
inside the project are rejected, including dangling links. The project root itself
may resolve through a symlink. This protects ordinary local editing; callers must
serialize saves and must not allow concurrent hostile filesystem mutation. Saving
is atomic per file, not transactional across a whole project: an I/O failure can
leave a mixture of old and new assets. YAML comments and original formatting are
not retained.

## Schema and version policy

The language-neutral schemas in `specs/schema` are canonical. Run
`npm run generate:schemas` after changing them. Checked-in generated schemas make
packages self-contained; `npm test` rejects stale generation and checks TypeScript
assignability in both directions using schema-derived types. Runtime constraints
such as numeric bounds and string patterns remain runtime checks, not TS guarantees.
Semantic rules intentionally extend JSON Schema and are covered by package tests.

Portable format version 1 is the only supported version. Unknown versions are
rejected, never guessed or silently rewritten. Package versions and file versions
are independent. A future incompatible format change requires a new format version,
an explicit migration API, diagnostics for information loss, and golden fixtures.
No speculative v0/v2 migration is provided. Studio v2 conversion is an explicit
boundary, not an automatic migration of unknown `.cstudio` files. Session-only fields
are excluded and must remain owned by Studio. Golden fixtures in `tests/fixtures`
pin this conversion; existing example projects also serve as filesystem fixtures.

## Studio migration

Studio now consumes SDK types and conversion helpers through local package links.
Build the SDK before building Studio. Its session persistence and legacy validators
remain in Studio because they accept older identities and optional tileset bindings
that portable schemas do not. Further validator removal requires explicit legacy
normalization and parity tests; replacing them outright would break existing files.

## Emulator client

`@clementina/emulator-client` provides a transport-independent `EmulatorClient` and
`createHttpEmulatorClient` for the Go automation server. It validates requests and
responses and has no Studio or Node runtime dependency. See
[emulator automation](emulator-automation.md) for API semantics and integration tests.
The separate `@clementina/emulator-client/node` entry point owns the Go automation
process, validates its advertised loopback endpoint and capabilities, mounts an
explicit SD root, and provides idempotent shutdown. Browser consumers do not import
this entry point.

`@clementina/basic` provides the versioned runtime load-plan validator, exact PRG
packing/inspection, BASIC bootstrap generation, and the ROM-compatible BASIC
tokenizer. It compiles numbered source to raw `SAVE`/`LOAD` files, validates and
inspects existing files (including style sidecars), and detokenizes them to
canonical `LIST`-style source. Relocatable output relies on ROM `LOAD` rebuilding
line links; callers can provide `TXTTAB` only when they need an absolute in-memory
image. See [program loading](program-loading.md) and [BASIC tooling](basic-tooling.md).

`@clementina/assembler` is the Node adapter for ca65/ld65. Callers provide the
source order, linker configuration, expected load address, optional bank, and
entry symbol explicitly. The adapter assembles each source with debug information,
links a binary plus `.dbg`, map, and label files, verifies every emitted segment's
address against its binary offset, resolves the entry symbol, and writes the exact
PRG consumed by the ROM loader. `createAssemblySourceMap` builds exact bidirectional
source-line/span/address mappings from ld65 v2 records. The transport-independent
emulator client consumes that structural interface for source breakpoints,
source-line stepping, and bounded JSR step-over without depending on the Node
assembler package. The adapter deliberately does not select addresses or generate
a linker map on the caller's behalf.

`@clementina/debug` is the editor-neutral orchestration layer. It presents one CPU
thread/frame, register snapshots, replacement-style source breakpoint ownership,
execution controls, source stepping, memory reads, bounded stop polling, and
cleanup. Its browser-compatible entry accepts structural emulator/source-map APIs.
`@clementina/debug/node` builds a project, owns the emulator process, prepares the
source map, and leaves execution stopped so an editor can configure breakpoints
before launching the BASIC load plan. See [editor debugger integration](debugger.md).

`@clementina/basic-lsp` is a Language Server Protocol server for BASIC source. Its
browser-compatible core (`analyzeDiagnostics`, `hoverAt`, `completionsFor`) reuses
`@clementina/basic`'s parser/tokenizer/token tables rather than re-deriving them; a
separate Node entry (`clementina-basic-lsp`, built on `vscode-languageserver`) wires
that core to stdio JSON-RPC. See [the BASIC language server](basic-lsp.md).

`@clementina/build` loads and validates a portable project, emits only explicitly
selected palette and CHR placements, then writes a validated load plan. Its result
is discriminated on `program.kind`: an assembly project (`build.assembly`) delegates
to `@clementina/assembler` and also writes a generated numbered BASIC bootstrap;
a BASIC project (`build.basic`) compiles `program.entry` through `@clementina/basic`
and produces a load plan whose terminal step is the compiled program itself (no
bootstrap file, since the emulator client launches it with direct ROM commands —
see [program loading](program-loading.md)). `program.kind: mixed` is rejected during
project validation; its composition rules are not defined yet. This is the API used
by CLI `build`/`run`; other consumers should call it instead of reproducing the
artifact ordering or filenames.
