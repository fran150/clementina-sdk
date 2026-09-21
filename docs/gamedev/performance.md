# Performance guidance

Facts:
- requested PHI2 range: 1 Hz-8 MHz
- video is dirty-page/client-paced
- logical display: 320×200
- host client defaults to 25 FPS requests
- wall time is independent of CPU frequency

Recommendations:
- update only changed video state;
- use prepared indexes for hot state;
- use MIA DMA/file-to-RAM paths for bulk transfers;
- do not treat emulator speed measurements as hardware guarantees;
- use wall time or explicit game ticks for gameplay timing.
