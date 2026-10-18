# Performance guidance

The figures here are CPU cycles, measured in the emulator. The 65C02's cycle
counts don't depend on its clock, so they hold at any PHI2 the board runs at;
time is cycles divided by PHI2. No PHI2 is guaranteed yet (see
[timing and interrupts](../architecture/timing-and-interrupts.md)).

What the emulator can't show is MIA's own time: its commands, DMA copies and SD
transfers finish at once there. A runtime routine that starts a copy returns
without waiting for it, and the next runtime call waits until it is done
(`rt_wait`). On the board those waits come on top of the figures below; they
are still to be measured on hardware.

Measured with clementina-6502 `b7ca75e` (ROM `1446d0f`) and this repository's
runtime. A call's count runs from its `JSR` to the instruction after it, so it
includes the macro's argument setup. To measure again, build the SDK and the
emulator's automation command (see [emulator automation](../emulator-automation.md))
and run `node scripts/measure-performance.mjs <clementina-automation>`.

## The frame budget

The video client asks MIA for a frame 5 to 30 times a second (25 by default,
`--fps`). A game that updates once per frame has this many cycles for it:

| PHI2 | 25 FPS | 30 FPS |
| --- | ---: | ---: |
| 1.2 MHz, the default | 48,000 | 40,000 |
| 4.6875 MHz, the fastest at the Pico's rated clock | 187,500 | 156,250 |
| 8 MHz, the requested maximum | 320,000 | 266,667 |

The kernel's Timer 1 interrupt takes 66 cycles every 6,250, about 1% of the
CPU at any PHI2, because the timer counts PHI2. It runs unless the game masks
interrupts or points `IRQ_VEC` elsewhere.

## MIA and the kernel

| Operation | Cycles |
| --- | ---: |
| Read or write a MIA register (`LDA`/`STA` absolute) | 4 |
| Write a sprite's 5-byte OAM record through its own index (`$C0`+n): select it, then 5 `LDA`/`STA` pairs | 46 |
| Point an index at a MIA address through the configuration fields (the runtime's seek) | 147 |
| Copy CPU → MIA through a window, simple loop (`LDA abs,X`, `STA port`, `INX`, `BNE`) | 13 per byte |
| The same copy unrolled 8 times | 9.4 per byte |
| Copy MIA → CPU, simple loop | 14 per byte |
| `KERN_CHROUT`, a printable character | 525 |
| `KERN_CHROUT`, carriage return mid-screen | 131 |
| `KERN_CHROUT`, carriage return on the bottom row, which scrolls (plus its DMA waits) | 1,491 |
| `KERN_GETKEY_NB`, no key waiting | 26 |
| `KERN_RDTIM` (plus the wait for MIA's clock command) | 804 |

An indexed read that crosses a page boundary takes 1 cycle more, so align the
buffers a loop reads.

## Runtime routines

Measured on the runtime demo: a 40 × 25 background (2,000 bytes), a 6,144-byte
tileset, a one-frame animation, and its player shape made of 1 and then of 4
sprites to see what each sprite adds.

| Call | Cycles |
| --- | ---: |
| `TickAnimation`, frame unchanged | 52 |
| `TickAnimation`, new frame | 3,010 + 306 per sprite |
| `MoveAnimation` | 2,590 + 306 per sprite |
| `StartAnimation` | 2,896 + 306 per sprite |
| `StopAnimation` | 336 + 9 per sprite |
| `DrawShape`, shape in MIA RAM | 947 + 306 per sprite |
| `DrawShape`, shape in a CPU bank | 644 + 586 per sprite |
| `HideSprites`, 2 sprites | 313 |
| `SetSpriteCount` | 216 |
| `SetScroll` | 281 |
| `SetViewport` | 238 |
| `SetLayers` | 211 |
| `SetChrBanks` | 301 |
| `GetCell` | 2,112–2,206 |
| `SetCell` | 2,337 |
| `DrawRect` (1 × 1 or 2 × 1), `DrawRow` (2 or 40 cells) or `DrawColumn` (1 or 25 cells), map in MIA RAM | 4,307–4,394 |
| `DrawRow`, 40 cells, map in a CPU bank | 6,437 |
| `DrawColumn`, 25 cells, map in a CPU bank | 26,653 |
| `DrawScreen`, map in MIA RAM | 4,466 |
| `DrawScreen`, map in a CPU bank | 77,663 (about 39 per byte) |
| `Relocate` or `UseTileset`, CPU bank → MIA | about 26 per byte (161,586 for the tileset) |
| `PlaySound` | 3,841 |
| `TickSound`, an entry of 3, 5 or 0 register pairs | 1,416, 2,076 or 519 |
| `StopSound` | 36 |
| `PlaySong` | 882 |
| `SongPosition` | 213 |
| `StopSong` | 252 |
| `RuntimeSave` / `RuntimeRestore` | 505 / 639 |

From MIA RAM the drawing calls cost the same whatever their size, because MIA's
DMA does the copying. Loads from SD aren't listed: the emulator's card has no
real timing.

## BASIC

Cycles per statement, including the interpreter's step to the next statement:

| Statement | Cycles |
| --- | ---: |
| `REM` | 320 |
| `A=A+1` | 2,963 |
| `N=N+1`, N created after 7 other variables | 3,134 |
| `A%=A%+1` | 3,841 |
| `A=A*B` | 3,446 |
| `A=B/C` | 4,653 |
| `D(3)=A` | 3,931 |
| `IF A<0 THEN A=0`, false | 2,872 |
| `IF N<3 THEN 100`, true, to the program's 5th line | 3,823 |
| `GOSUB 900` from line 180 / `RETURN` | 1,379 / 455 |
| `FOR I=1 TO 3` / each `NEXT` | 3,392 / 816–959 |
| `POKE 700,1` | 5,241 |
| `B=PEEK(700)` | 4,918 |
| `PRINT "A";` | 3,051 |
| `A$="AB"` | 2,877 |
| `X=INT(A/2)` | 6,128 |
| `X=SIN(A)` | 25,947 |

At 1.2 MHz and 25 FPS that is about 16 simple statements per frame, or 400 a
second. Integer variables are slower than floating point ones, because BASIC
converts them to floating point to do arithmetic. BASIC finds a variable by
searching the variables in the order they were created, so create the busiest
ones first. A `GOTO` or `GOSUB` searches for its line from the start of the
program, unless the target's number has a higher high byte than the current
line's (`GOTO 300` from line 100 searches onwards from line 100, `GOTO 200`
from the start), so put the lines jumped to most often near the start.

## Recommendations

- Update only the video state that changed.
- Keep hot state behind prepared indexes: once an index is selected, each byte
  is one `STA`.
- Keep what is drawn every frame in MIA RAM, where a drawing call costs about
  4,400 cycles whatever its size.
- Use MIA DMA and file-to-RAM paths for bulk transfers.
- Use wall time or explicit game ticks for gameplay timing, not cycle counts.
