# Catch the Star

A small, complete game for Clementina. Stars fall from the top of the
screen, you move the basket with the left and right arrow keys (or a
gamepad; hold Shift to move faster), and each star you catch scores a point. Three misses end the game,
which keeps the high score and lets you play again. Every ten catches the
stars fall faster.

The book chapter "Your first project" builds this game step by step,
starting from `clementina new`.

- `src/main.cbas` is the BASIC program. It owns the rules: the title
  screen, the score, the lives, how fast the stars fall, where each new star
  starts, game over and the high score.
- `src/stars.s` is the assembly routine `play`, which BASIC calls with
  `SYS 28672`. It runs the game 60 frames a second: it reads the arrows,
  moves and draws the basket, and moves and draws the stars. It returns to
  BASIC when a star is caught or missed, or when it has started the new star
  BASIC chose. Running the frames in assembly keeps the stars falling at a
  steady pace; a BASIC loop at 1.2 MHz is too slow to.
- The two parts share the bytes at `$0280`-`$0294` (640-660), which BASIC
  reads and writes with `PEEK` and `POKE`:

  | Address | What it holds |
  | --- | --- |
  | 640 | The basket's left column; BASIC sets the start, `play` moves it |
  | 641 | Stars caught since BASIC last looked; `play` adds to it |
  | 642 | Stars missed since BASIC last looked; `play` adds to it |
  | 643 | The column of the next new star plus one, or 0 for none |
  | 644 | Frames between two star moves; BASIC lowers it to speed up |
  | 645-652 | Each star's column |
  | 653-660 | Each star's row, or 0 for an unused slot |

- The palette config puts the main palette (white text on black) in bank 0,
  the star palette (yellow) in bank 1 and the basket palette (green) in
  bank 2. Text draws with color 1 of its cell's bank.
- `link.cfg` places the assembly code at `$7000`, and
  `build.basic.memoryTop` keeps BASIC below it.
- `checks/smoke.json` starts a game and expects the score line, and
  `checks/code.json` expects the basket at column 18 in memory.

The game reads held keys, so play it in the video client window. From this
folder:

```sh
clementina build
clementina-emulator --sd build/sd
```

Then type `RUN "BOOT.BAS"` in the video client. `clementina check` runs the
game headless and tests both checks.
