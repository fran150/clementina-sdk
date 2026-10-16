# MIA GPIO defaults

| GPIO | Function |
| ---: | --- |
| 0-3 | SD MISO/CS/SCK/MOSI |
| 4-5 | audio L/R |
| 6 | MIA CS |
| 7 | 6502 R/W |
| 8-15 | D0-D7 |
| 16-20 | A0-A4 |
| 21 | PHI2 |
| 22 | IRQB |
| 26 | RESB |
| 27 | MIA_RESETB |
| 28 | audio IRQ timer |

Every pin with its signal, firmware define, direction, peripheral and a
description: `specs/mia-gpio.json`. The SD and audio pins are build-time
defaults that the rev 1 board is wired to; connector pinouts, power and parts
are in the clementina-hardware README.

The emulator repo's Raspberry Pi 5 ↔ Pico pin map is a development fixture, not
part of the software ABI.
