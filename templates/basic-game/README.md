# Starter project

`clementina.yaml` is the portable project manifest. `src/main.bas` is a small
playable input loop: press `A` to catch the star, then `R` to play again.
The palette and palette config are portable assets; the build loads the config
before the BASIC program. `checks/smoke.json` describes the input response to
verify; `clementina check` runs it.

This starter begins with a BASIC program. A project can have a BASIC program,
assembly code, or both: add `build.assembly` to `clementina.yaml` when you want
BASIC to load and call assembly routines.

Edit the source and assets, then from this folder:

```sh
clementina project validate
clementina build
clementina run
clementina check
```
