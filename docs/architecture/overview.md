# Architecture overview

Clementina is a W65C02S system with three important memory domains:

1. 64 KiB CPU address space
2. 512 KiB banked external RAM through a 16 KiB CPU window
3. 256 KiB MIA RAM through indexed windows

MIA is implemented by a Raspberry Pi Pico 2 W. It supplies PHI2, boot loading,
indexed RAM, commands, interrupts, video-state publishing, input, audio, timing,
and SD/FAT services.

The host client renders a 320×200 tile/sprite display from mirrored MIA state;
the 6502 does not stream raw framebuffer pixels.
