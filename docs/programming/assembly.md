# Assembly development direction

Use the existing ca65/ld65 toolchain already used by `clementina-rom`; do not create
a new Clementina assembler.

The SDK should provide generated includes, linker configurations, startup/runtime
support, asset symbols, and `clementina asm build`.

Code that needs stable ROM services should call the fixed kernel jump table, not
internal kernel labels. Never hardcode the current BASIC image end/heap start.
