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

`@clementina/basic` provides the versioned runtime load-plan validator, exact PRG
packing/inspection, and BASIC bootstrap source generation. Despite the package
name, it does not yet tokenize arbitrary BASIC programs. The emulator client's
`launchLoadPlan` method enters generated source through the real ROM tokenizer.
See [program loading](program-loading.md).
