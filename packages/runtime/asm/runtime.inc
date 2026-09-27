; Clementina runtime: routines that load and use the assets the SDK builds.
; docs/gamedev/builder.md describes the files, the descriptors and every
; routine. The SDK assembles the runtime into runtime.lib; a game includes
; this file (assets.inc does) and links against the library.
;
; Conventions:
; - A routine takes its asset's descriptor in A (low) and X (high); the
;   macros below load them. Other arguments go in the rt_a0-rt_a11 block.
; - Carry clear is success. On failure carry is set and rt_error says why.
; - Macro arguments follow ca65's usual form: #expr is a value, anything
;   else is the memory holding it. An asset or instance is named by its label.
; - Routines use MIA index descriptors $40 and $41, both index windows,
;   CFG_SELECT and the command registers, and leave them changed.

.ifndef RT_RUNTIME_INC
RT_RUNTIME_INC = 1

; ---------------------------------------------------------------------------
; Descriptors (assets.s)
; ---------------------------------------------------------------------------

; Asset types, descriptor byte 0.
RT_PALETTES   = 1
RT_TILESET    = 2
RT_BACKGROUND = 3
RT_OVERLAY    = 4
RT_SPRITES    = 5
RT_SONG       = 6
RT_SOUND      = 7

RT_D_TYPE     = 0           ; asset type
RT_D_LOC      = 1           ; where it is now, 3 bytes; RT_NOT_LOADED if nowhere
RT_D_DEFAULT  = 4           ; its default slot's location, 3 bytes
RT_D_SIZE     = 7           ; its file's size, 3 bytes
RT_D_PATH     = 10          ; pointer to its file's path, zero-terminated
; Tileset
RT_D_BPP1     = 12          ; nonzero for a 1bpp tileset
; Background: the map, then the part of it that is loaded (the window),
; stored row by row, window-wide, tiles and then attributes.
RT_D_WIDTH    = 12          ; map columns, 2 bytes
RT_D_HEIGHT   = 14          ; map rows, 2 bytes
RT_D_WIN_COL  = 16          ; the window's first column, 2 bytes
RT_D_WIN_ROW  = 18          ; its first row, 2 bytes
RT_D_WIN_COLS = 20          ; its columns, 2 bytes
RT_D_WIN_ROWS = 22          ; its rows, 2 bytes
; Overlay
RT_D_HOLES    = 12          ; placeholder count
RT_D_HOLE_TABLE = 13        ; pointer: column, row, width, height per placeholder
; Sprite file: items are its shapes, then its animations.
RT_D_SHAPES   = 12          ; shape count
RT_D_ANIMS    = 13          ; animation count
RT_D_ITEMS    = 14          ; pointer: file offset (3 bytes) and size (2) per item
RT_D_LOCS     = 16          ; pointer: each item's location, 3 bytes
; Song
RT_D_VOICES   = 12          ; per voice, its track's offset in the file; $FFFF: none
; Sound
RT_D_ENTRIES  = 12          ; entry count, 2 bytes

; A location is 3 bytes: a MIA address ($000000-$03FFFF), or $80 | bank in
; the high byte with a CPU address ($8000-$BFFF) in the low two.
RT_NOT_LOADED = $FFFFFF
.define RT_BANK_LOC(bank, address) (((($80 | (bank)) << 16)) | (address))

; Errors, in rt_error when carry is set.
RT_ERR_NOT_LOADED = 1       ; the asset or item is not loaded
RT_ERR_LOCATION   = 2       ; a location is invalid, or of the wrong kind
RT_ERR_FILE       = 3       ; the SD card reported an error, or the file is short
RT_ERR_RANGE      = 4       ; coordinates or a size fall outside the asset
RT_ERR_MISSING    = 5       ; a shape an animation uses is not loaded
RT_ERR_ARGUMENT   = 6       ; an argument is out of range

; An animation instance, which the game allocates: .res RT_ANIM_SIZE
RT_ANIM_FILE     = 0           ; sprite file descriptor, 2 bytes
RT_ANIM_NUMBER   = 2           ; animation number in the file
RT_ANIM_FRAME    = 3           ; current frame
RT_ANIM_TICKS    = 4           ; ticks left in it
RT_ANIM_X        = 5           ; position, 2 bytes each
RT_ANIM_Y        = 7
RT_ANIM_SPRITE   = 9           ; first sprite record
RT_ANIM_DRAWN    = 10          ; sprites the current frame uses
RT_ANIM_FLAGS    = 11          ; bit 7: running
RT_ANIM_SIZE     = 12

; TickAnimation's result in A.
RT_TICK_FRAME = 1           ; a new frame is showing
RT_TICK_WRAP  = 2           ; ... and it is frame 0 again

; ---------------------------------------------------------------------------
; Zero page and routines
; ---------------------------------------------------------------------------

.globalzp rt_state, rt_error
.globalzp rt_a0, rt_a1, rt_a2, rt_a3, rt_a4, rt_a5, rt_a6, rt_a7, rt_a8, rt_a9, rt_a10, rt_a11
; Bytes RuntimeSave keeps; zp.s checks it against the block.
RT_STATE_SIZE = 42

.global rt_load, rt_load_at, rt_load_start, rt_load_start_at, rt_load_busy, rt_load_wait
.global rt_load_part, rt_relocate, rt_forget
.global rt_use_palettes, rt_use_palette_bank, rt_use_tileset
.global rt_draw_rect, rt_draw_screen, rt_draw_column, rt_draw_row, rt_get_cell, rt_set_cell
.global rt_load_rect, rt_load_rect_at, rt_load_rows, rt_load_rows_at, rt_load_columns, rt_load_columns_at
.global rt_show_overlay, rt_fill_placeholder
.global rt_load_shape, rt_load_shape_at, rt_load_animation, rt_load_animation_at
.global rt_load_animation_shapes, rt_forget_shape, rt_draw_shape
.global rt_start_animation, rt_tick_animation, rt_move_animation, rt_stop_animation
.global rt_play_song, rt_stop_song, rt_song_position
.global rt_play_sound, rt_tick_sound, rt_stop_sound
.global rt_hide_sprites, rt_set_sprite_count
.global rt_set_layers, rt_set_chr_banks, rt_set_scroll, rt_set_viewport

; ---------------------------------------------------------------------------
; Argument helpers
; ---------------------------------------------------------------------------

.macro rt__asset asset
        lda #<(asset)
        ldx #>(asset)
.endmacro
.macro rt__byte dst, arg
        lda arg
        sta dst
.endmacro
.macro rt__word dst, arg
    .if .match(.left(1, {arg}), #)
        lda #<(.right(.tcount({arg})-1, {arg}))
        sta dst
        lda #>(.right(.tcount({arg})-1, {arg}))
        sta dst+1
    .else
        lda arg
        sta dst
        lda arg+1
        sta dst+1
    .endif
.endmacro
.macro rt__long dst, arg
    .if .match(.left(1, {arg}), #)
        lda #<(.right(.tcount({arg})-1, {arg}))
        sta dst
        lda #>(.right(.tcount({arg})-1, {arg}))
        sta dst+1
        lda #^(.right(.tcount({arg})-1, {arg}))
        sta dst+2
    .else
        lda arg
        sta dst
        lda arg+1
        sta dst+1
        lda arg+2
        sta dst+2
    .endif
.endmacro

; ---------------------------------------------------------------------------
; Every asset
; ---------------------------------------------------------------------------

; Load asset[, location]: the whole file, at its default slot or at location.
.macro Load asset, location
    .ifblank location
        rt__asset asset
        jsr rt_load
    .else
        rt__long rt_a0, location
        rt__asset asset
        jsr rt_load_at
    .endif
.endmacro
; LoadStart asset[, location]: starts a load into MIA RAM and returns at once;
; poll LoadBusy (A = 0 once done), then LoadWait for the result. A load into
; a bank finishes before LoadStart returns.
.macro LoadStart asset, location
    .ifblank location
        rt__asset asset
        jsr rt_load_start
    .else
        rt__long rt_a0, location
        rt__asset asset
        jsr rt_load_start_at
    .endif
.endmacro
.macro LoadBusy
        jsr rt_load_busy
.endmacro
.macro LoadWait
        jsr rt_load_wait
.endmacro
; LoadPart asset, offset, length, location: length bytes from offset in the file.
.macro LoadPart asset, offset, length, location
        rt__long rt_a0, offset
        rt__long rt_a3, length
        rt__long rt_a6, location
        rt__asset asset
        jsr rt_load_part
.endmacro
; Relocate asset, location: moves the loaded asset there.
.macro Relocate asset, location
        rt__long rt_a0, location
        rt__asset asset
        jsr rt_relocate
.endmacro
; Forget asset: marks it not loaded.
.macro Forget asset
        rt__asset asset
        jsr rt_forget
.endmacro

; ---------------------------------------------------------------------------
; Palettes and tilesets
; ---------------------------------------------------------------------------

; UsePalettes config: copies all 16 banks into palette RAM.
.macro UsePalettes config
        rt__asset config
        jsr rt_use_palettes
.endmacro
; UsePaletteBank config, bank[, target]: one bank, into bank target (default: the same).
.macro UsePaletteBank config, bank, target
        rt__byte rt_a0, bank
    .ifblank target
        sta rt_a1
    .else
        rt__byte rt_a1, target
    .endif
        rt__asset config
        jsr rt_use_palette_bank
.endmacro
; UseTileset tileset, chrBank: copies it into the CHR bank and sets the
; bank's 1bpp flag to match.
.macro UseTileset tileset, bank
        rt__byte rt_a0, bank
        rt__asset tileset
        jsr rt_use_tileset
.endmacro

; ---------------------------------------------------------------------------
; Backgrounds. Map coordinates are 16-bit; tables are 0-7, 40 x 25 cells.
; ---------------------------------------------------------------------------

; DrawScreen bg, col, row, table: the 40 x 25 cells from (col, row), or as
; many as the map has, to the table's top left.
.macro DrawScreen bg, col, row, table
        rt__word rt_a0, col
        rt__word rt_a2, row
        rt__byte rt_a6, table
        rt__asset bg
        jsr rt_draw_screen
.endmacro
; DrawRect bg, col, row, width, height, table, tcol, trow
.macro DrawRect bg, col, row, width, height, table, tcol, trow
        rt__word rt_a0, col
        rt__word rt_a2, row
        rt__byte rt_a4, width
        rt__byte rt_a5, height
        rt__byte rt_a6, table
        rt__byte rt_a7, tcol
        rt__byte rt_a8, trow
        rt__asset bg
        jsr rt_draw_rect
.endmacro
; DrawColumn bg, col, row, count, table, tcol, trow: count cells down.
.macro DrawColumn bg, col, row, count, table, tcol, trow
        rt__word rt_a0, col
        rt__word rt_a2, row
        rt__byte rt_a5, count
        rt__byte rt_a6, table
        rt__byte rt_a7, tcol
        rt__byte rt_a8, trow
        rt__asset bg
        jsr rt_draw_column
.endmacro
; DrawRow bg, col, row, count, table, tcol, trow: count cells across.
.macro DrawRow bg, col, row, count, table, tcol, trow
        rt__word rt_a0, col
        rt__word rt_a2, row
        rt__byte rt_a4, count
        rt__byte rt_a6, table
        rt__byte rt_a7, tcol
        rt__byte rt_a8, trow
        rt__asset bg
        jsr rt_draw_row
.endmacro
; GetCell bg, col, row: A = tile, X = attribute, from the loaded map.
.macro GetCell bg, col, row
        rt__word rt_a0, col
        rt__word rt_a2, row
        rt__asset bg
        jsr rt_get_cell
.endmacro
; SetCell bg, col, row, tile, attr: changes the loaded map; draw it to show it.
.macro SetCell bg, col, row, tile, attr
        rt__word rt_a0, col
        rt__word rt_a2, row
        rt__byte rt_a6, tile
        rt__byte rt_a7, attr
        rt__asset bg
        jsr rt_set_cell
.endmacro
; LoadRect bg, col, row, width, height[, location]: loads that part of the
; map from the card; it becomes the window the draw routines read.
.macro LoadRect bg, col, row, width, height, location
        rt__word rt_a0, col
        rt__word rt_a2, row
        rt__word rt_a4, width
        rt__word rt_a6, height
    .ifblank location
        rt__asset bg
        jsr rt_load_rect
    .else
        rt__long rt_a8, location
        rt__asset bg
        jsr rt_load_rect_at
    .endif
.endmacro
; LoadRows bg, row, count[, location]: whole rows.
.macro LoadRows bg, row, count, location
        rt__word rt_a2, row
        rt__word rt_a6, count
    .ifblank location
        rt__asset bg
        jsr rt_load_rows
    .else
        rt__long rt_a8, location
        rt__asset bg
        jsr rt_load_rows_at
    .endif
.endmacro
; LoadColumns bg, col, count[, location]: whole columns.
.macro LoadColumns bg, col, count, location
        rt__word rt_a0, col
        rt__word rt_a4, count
    .ifblank location
        rt__asset bg
        jsr rt_load_columns
    .else
        rt__long rt_a8, location
        rt__asset bg
        jsr rt_load_columns_at
    .endif
.endmacro

; ---------------------------------------------------------------------------
; Overlays
; ---------------------------------------------------------------------------

; ShowOverlay overlay: copies it into the overlay's tables.
.macro ShowOverlay overlay
        rt__asset overlay
        jsr rt_show_overlay
.endmacro
; FillPlaceholder overlay, placeholder, tiles: writes width x height tile
; numbers from CPU memory into the shown overlay, row by row.
.macro FillPlaceholder overlay, placeholder, tiles
        rt__byte rt_a0, placeholder
        rt__word rt_a1, tiles
        rt__asset overlay
        jsr rt_fill_placeholder
.endmacro

; ---------------------------------------------------------------------------
; Sprite files, shapes and animations
; ---------------------------------------------------------------------------

; LoadSprites file[, location]: the whole file; every item is then loaded.
.macro LoadSprites file, location
        Load file, location
.endmacro
; LoadShape file, shape[, location]: one shape. Without a location it goes
; where it would be if the whole file were in its slot.
.macro LoadShape file, shape, location
        rt__byte rt_a0, shape
    .ifblank location
        rt__asset file
        jsr rt_load_shape
    .else
        rt__long rt_a1, location
        rt__asset file
        jsr rt_load_shape_at
    .endif
.endmacro
; LoadAnimation file, anim[, location]: one animation's frames.
.macro LoadAnimation file, anim, location
        rt__byte rt_a0, anim
    .ifblank location
        rt__asset file
        jsr rt_load_animation
    .else
        rt__long rt_a1, location
        rt__asset file
        jsr rt_load_animation_at
    .endif
.endmacro
; LoadAnimationShapes file, anim: loads the shapes a loaded animation uses
; that are not loaded yet.
.macro LoadAnimationShapes file, anim
        rt__byte rt_a0, anim
        rt__asset file
        jsr rt_load_animation_shapes
.endmacro
; ForgetShape file, shape
.macro ForgetShape file, shape
        rt__byte rt_a0, shape
        rt__asset file
        jsr rt_forget_shape
.endmacro
; DrawShape file, shape, sprite, x, y[, flips]: writes the shape's sprites
; from record sprite on, with its origin at (x, y). flips: bit 0 mirrors it
; left to right, bit 1 top to bottom. A = the next free sprite record.
.macro DrawShape file, shape, sprite, xpos, ypos, flips
        rt__byte rt_a0, shape
        rt__byte rt_a1, sprite
        rt__word rt_a2, xpos
        rt__word rt_a4, ypos
    .ifblank flips
        stz rt_a6
    .else
        rt__byte rt_a6, flips
    .endif
        rt__asset file
        jsr rt_draw_shape
.endmacro
; StartAnimation inst, file, anim, sprite, x, y: shows frame 0.
.macro StartAnimation inst, file, anim, sprite, xpos, ypos
        lda #<(file)
        sta rt_a0
        lda #>(file)
        sta rt_a1
        rt__byte rt_a2, anim
        rt__byte rt_a3, sprite
        rt__word rt_a4, xpos
        rt__word rt_a6, ypos
        rt__asset inst
        jsr rt_start_animation
.endmacro
; TickAnimation inst: one tick; A has RT_TICK_FRAME set when the frame
; changed, and RT_TICK_WRAP when it went back to frame 0.
.macro TickAnimation inst
        rt__asset inst
        jsr rt_tick_animation
.endmacro
; MoveAnimation inst, x, y
.macro MoveAnimation inst, xpos, ypos
        rt__word rt_a4, xpos
        rt__word rt_a6, ypos
        rt__asset inst
        jsr rt_move_animation
.endmacro
; StopAnimation inst: hides its sprites.
.macro StopAnimation inst
        rt__asset inst
        jsr rt_stop_animation
.endmacro
; HideSprites first, count: sets the disable bit of count records (0: 256).
.macro HideSprites first, count
        rt__byte rt_a0, first
        rt__byte rt_a1, count
        jsr rt_hide_sprites
.endmacro
; SetSpriteCount count: the renderer scans records 0 to count - 1 (0: 256).
.macro SetSpriteCount count
        lda count
        jsr rt_set_sprite_count
.endmacro

; ---------------------------------------------------------------------------
; Audio
; ---------------------------------------------------------------------------

; PlaySong song: starts the song's voices from the top. The song must be in
; MIA RAM. Voices the song leaves free keep doing what they were doing.
.macro PlaySong song
        rt__asset song
        jsr rt_play_song
.endmacro
; StopSong song: stops and silences the song's voices.
.macro StopSong song
        rt__asset song
        jsr rt_stop_song
.endmacro
; SongPosition voice: A/X = the voice's note index, Y = its sequencer status.
.macro SongPosition voice
        ldx voice
        jsr rt_song_position
.endmacro
; PlaySound sound, voice: takes the voice from the sequencer and plays the
; first frame; TickSound plays the next one each tick.
.macro PlaySound sound, voice
        rt__byte rt_a0, voice
        rt__asset sound
        jsr rt_play_sound
.endmacro
; TickSound voice: A = nonzero while the sound goes on. After its last frame
; the voice goes back to the sequencer.
.macro TickSound voice
        ldx voice
        jsr rt_tick_sound
.endmacro
; StopSound voice
.macro StopSound voice
        ldx voice
        jsr rt_stop_sound
.endmacro

; ---------------------------------------------------------------------------
; Video
; ---------------------------------------------------------------------------

; SetLayers mask: bit 0 background, bit 1 overlay, bit 2 sprites.
.macro SetLayers mask
        lda mask
        jsr rt_set_layers
.endmacro
; SetChrBanks bg, bgAlt, overlay, overlayAlt, sprites: the CHR bank (0-7)
; each layer draws from.
.macro SetChrBanks bg, bgalt, ov, ovalt, spr
        rt__byte rt_a0, bg
        rt__byte rt_a1, bgalt
        rt__byte rt_a2, ov
        rt__byte rt_a3, ovalt
        rt__byte rt_a4, spr
        jsr rt_set_chr_banks
.endmacro
; SetScroll x, y: the background viewport's top-left pixel.
.macro SetScroll xpos, ypos
        rt__word rt_a0, xpos
        rt__word rt_a2, ypos
        jsr rt_set_scroll
.endmacro
; SetViewport mode, set: the background plane (0-5) and table set (0-1).
.macro SetViewport mode, set
        rt__byte rt_a0, mode
        rt__byte rt_a1, set
        jsr rt_set_viewport
.endmacro

; ---------------------------------------------------------------------------
; Interrupt handlers
; ---------------------------------------------------------------------------

; A handler that calls runtime routines writes MIA_CTX_PUSH on entry, then
; RuntimeSave; RuntimeRestore and MIA_CTX_POP before RTI. Both use A and X.
.macro RuntimeSave
    .local loop
        ldx #RT_STATE_SIZE-1
loop:   lda rt_state,x
        pha
        dex
        bpl loop
.endmacro
; Waits for the handler's own MIA command to finish, so the pop that follows
; can't undo a command still reading the descriptors.
.macro RuntimeRestore
    .local wait, loop
wait:   lda $FFEA
        and #%00001100
        bne wait
        ldx #0
loop:   pla
        sta rt_state,x
        inx
        cpx #RT_STATE_SIZE
        bne loop
.endmacro

.endif
