# Timing and interrupts

## PHI2

MIA generates PHI2.

- default: **1,200,000 Hz (1.2 MHz)**
- requested minimum: 1 Hz
- requested maximum: 8 MHz

Speed changes are staged through MIA configuration fields and applied asynchronously.

## Wall time

For gameplay and elapsed-time logic, prefer MIA wall time over counting CPU cycles.

Command `$55` latches:

- 32-bit milliseconds at `$11078`
- 24-bit 60 Hz TI ticks at `$1107C`
- snapshot version at `$1107F`

Command `$56` sets TI. TI wraps at 5,184,000 ticks (24 hours).

## Top-level MIA IRQ bits

| Bit | Meaning |
| ---: | --- |
| 0 | error |
| 1 | index A wrapped |
| 2 | index B wrapped |
| 3 | command |
| 4 | speed changed |
| 5 | video frame request |
| 6 | video frame sent |
| 7 | video frame acknowledged |
| 8 | keyboard/text input |
| 9 | mouse input |
| 10 | gamepad input |
| 11 | SD done |
| 12 | SD error |
| 13 | filesystem event |
| 14 | audio sequencer done |
| 15 | aggregate triggered |
