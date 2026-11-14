# BASIC game starter

`clementina.yaml` is the portable project manifest. `src/main.bas` is a small
playable input loop: press `A` to catch the star, then `R` to play again.
The palette and palette config are portable assets; the build loads the config
before the BASIC program. `checks/smoke.json` describes the input response to
verify; `clementina check` runs it.

Edit the source and assets, then from this folder:

```sh
clementina project validate
clementina build
clementina run
clementina check
```
