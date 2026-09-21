# Current compatibility notes

## Audio sequencer and SD/FS MIA RAM

Audio sequencer track buffers currently occupy `$13000-$13FFF`, while SD/FS state
occupies `$13000-$13BFF`. Current MIA firmware and emulator code both define these
overlapping regions.

This does not affect the portable Phase 2 project/asset file formats. It does matter
to future runtime packing/linking, so it is recorded in `specs/known-issues.json`
until the upstream MIA RAM layout is reconciled.
