# Assembly development direction

Use the existing ca65/ld65 toolchain already used by `clementina-rom`; do not create
a new Clementina assembler.

The SDK provides `clementina.inc`, generated from `specs/`, on every assembly
build's include path (see [assembly builds](../assembly.md#machine-includes)). It
should also provide linker configurations, startup support and `clementina asm build`.

Code that needs stable ROM services should call the fixed kernel jump table, not
internal kernel labels. Never hardcode the current BASIC image end/heap start.
