# SD/FAT storage

MIA acts as a filesystem controller; 6502 software should normally use FAT commands.

MIA RAM `$13000-$13BFF` contains:
- 64-byte control block
- 512-byte sector buffer
- 256-byte path
- 256-byte directory result
- 1984-byte transfer buffer
- second 256-byte path overlaying the start of the transfer buffer

Protocol version: 7.

There are 16 file-handle slots and one directory cursor.
Indexes `$E0-$E5` expose control/sector/path/directory/transfer/path2.

Filesystem commands run asynchronously at MIA level. Poll busy or use IRQ bits
11 (done), 12 (error), 13 (filesystem event).

`FS_FILE_INFO` is command `$89`.

`FS_LOAD_PART` (`$8A`, protocol 7) loads part of a file into MIA RAM:
- **A run of bytes:** with `SD_PART_ROWS` (`$34-$35`) zero, it loads
  `SD_TRANSFER_LEN` bytes from file offset `SD_PART_OFFSET` (`$30-$33`) to
  `SD_DEST_ADDR`.
- **A rectangle:** otherwise it loads that many rows. Each row is read
  `SD_PART_FILE_STRIDE` (`$36-$39`) further into the file and written
  `SD_PART_RAM_STRIDE` (`$3A-$3C`) further into MIA RAM.
- **End of file:** reaching it ends the load early and still succeeds, with
  `SD_FILE_POS` holding the count loaded.
