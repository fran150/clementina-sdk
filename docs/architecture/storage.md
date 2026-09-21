# SD/FAT storage

MIA acts as a filesystem controller; 6502 software should normally use FAT commands.

MIA RAM `$13000-$13BFF` contains:
- 64-byte control block
- 512-byte sector buffer
- 256-byte path
- 256-byte directory result
- 1984-byte transfer buffer
- second 256-byte path overlaying the start of the transfer buffer

Protocol version: 6.

There are 16 file-handle slots and one directory cursor.
Indexes `$E0-$E5` expose control/sector/path/directory/transfer/path2.

Filesystem commands run asynchronously at MIA level. Poll busy or use IRQ bits
11 (done), 12 (error), 13 (filesystem event).

`FS_FILE_INFO` is command `$89`.
