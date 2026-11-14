; The Clementina library: the SDK's 6502 routines for Clementina programs.
; docs/gamedev/library.md describes every routine; docs/gamedev/builder.md
; describes the asset files and descriptors. The SDK assembles the library into clementina.lib and links it into
; every assembly program; a program includes this file (assets.inc does).
;
; Conventions:
; - A routine takes its asset's descriptor in A (low) and X (high); the
;   macros below load them. Other arguments go in the cl_a0-cl_a11 block.
; - Carry clear is success. On failure carry is set and cl_error says why.
; - Macro arguments follow ca65's usual form: #expr is a value, anything
;   else is the memory holding it. An asset or instance is named by its label.
; - Routines use MIA index descriptors $40 and $41, both index windows,
;   CFG_SELECT and the command registers, and leave them changed.

.ifndef CL_LIB_INC
CL_LIB_INC = 1

; ---------------------------------------------------------------------------
; Descriptors (assets.s)
; ---------------------------------------------------------------------------

; Asset types, descriptor byte 0.
CL_PALETTES   = 1
CL_TILESET    = 2
CL_BACKGROUND = 3
CL_OVERLAY    = 4
CL_SPRITES    = 5
CL_SONG       = 6
CL_SOUND      = 7

CL_D_TYPE     = 0           ; asset type
CL_D_LOC      = 1           ; where it is now, 3 bytes; CL_NOT_LOADED if nowhere
CL_D_DEFAULT  = 4           ; its default slot's location, 3 bytes
CL_D_SIZE     = 7           ; its file's size, 3 bytes
CL_D_PATH     = 10          ; pointer to its file's path, zero-terminated
; Tileset
CL_D_BPP1     = 12          ; nonzero for a 1bpp tileset
; Background: the map, then the part of it that is loaded (the window),
; stored row by row, window-wide, tiles and then attributes.
CL_D_WIDTH    = 12          ; map columns, 2 bytes
CL_D_HEIGHT   = 14          ; map rows, 2 bytes
CL_D_WIN_COL  = 16          ; the window's first column, 2 bytes
CL_D_WIN_ROW  = 18          ; its first row, 2 bytes
CL_D_WIN_COLS = 20          ; its columns, 2 bytes
CL_D_WIN_ROWS = 22          ; its rows, 2 bytes
; Overlay
CL_D_HOLES    = 12          ; placeholder count
CL_D_HOLE_TABLE = 13        ; pointer: column, row, width, height per placeholder
; Sprite file: items are its shapes, then its animations.
CL_D_SHAPES   = 12          ; shape count
CL_D_ANIMS    = 13          ; animation count
CL_D_ITEMS    = 14          ; pointer: file offset (3 bytes) and size (2) per item
CL_D_LOCS     = 16          ; pointer: each item's location, 3 bytes
; Song
CL_D_VOICES   = 12          ; per voice, its track's offset in the file; $FFFF: none
; Sound
CL_D_ENTRIES  = 12          ; entry count, 2 bytes

; A location is 3 bytes: a MIA address ($000000-$03FFFF), or $80 | bank in
; the high byte with a CPU address ($8000-$BFFF) in the low two.
CL_NOT_LOADED = $FFFFFF
.define CL_BANK_LOC(bank, address) (((($80 | (bank)) << 16)) | (address))

; Errors, in cl_error when carry is set.
CL_ERR_NOT_LOADED = 1       ; the asset or item is not loaded
CL_ERR_LOCATION   = 2       ; a location is invalid, or of the wrong kind
CL_ERR_FILE       = 3       ; the SD card reported an error, or the file is short
CL_ERR_RANGE      = 4       ; coordinates or a size fall outside the asset
CL_ERR_MISSING    = 5       ; a shape an animation uses is not loaded
CL_ERR_ARGUMENT   = 6       ; an argument is out of range

; An animation instance, which the game allocates: .res CL_ANIM_SIZE
CL_ANIM_FILE     = 0           ; sprite file descriptor, 2 bytes
CL_ANIM_NUMBER   = 2           ; animation number in the file
CL_ANIM_FRAME    = 3           ; current frame
CL_ANIM_TICKS    = 4           ; ticks left in it
CL_ANIM_X        = 5           ; position, 2 bytes each
CL_ANIM_Y        = 7
CL_ANIM_SPRITE   = 9           ; first sprite record
CL_ANIM_DRAWN    = 10          ; sprites the current frame uses
CL_ANIM_FLAGS    = 11          ; bit 7: running
CL_ANIM_SIZE     = 12

; TickAnimation's result in A.
CL_TICK_FRAME = 1           ; a new frame is showing
CL_TICK_WRAP  = 2           ; ... and it is frame 0 again

; ReadPad's result in A, a bit per control held.
CL_PAD_UP     = $01
CL_PAD_DOWN   = $02
CL_PAD_LEFT   = $04
CL_PAD_RIGHT  = $08
CL_PAD_A      = $10
CL_PAD_B      = $20
CL_PAD_SELECT = $40
CL_PAD_START  = $80

; ---------------------------------------------------------------------------
; Zero page and routines
; ---------------------------------------------------------------------------

.globalzp cl_state, cl_error
.globalzp cl_a0, cl_a1, cl_a2, cl_a3, cl_a4, cl_a5, cl_a6, cl_a7, cl_a8, cl_a9, cl_a10, cl_a11
; Bytes LibSave keeps; zp.s checks it against the block.
CL_STATE_SIZE = 42

.global cl_load, cl_load_at, cl_load_start, cl_load_start_at, cl_load_busy, cl_load_wait
.global cl_load_part, cl_relocate, cl_forget
.global cl_use_palettes, cl_use_palette_bank, cl_use_tileset
.global cl_draw_rect, cl_draw_screen, cl_draw_column, cl_draw_row, cl_get_cell, cl_set_cell
.global cl_load_rect, cl_load_rect_at, cl_load_rows, cl_load_rows_at, cl_load_columns, cl_load_columns_at
.global cl_show_overlay, cl_fill_placeholder
.global cl_load_shape, cl_load_shape_at, cl_load_animation, cl_load_animation_at
.global cl_load_animation_shapes, cl_forget_shape, cl_draw_shape
.global cl_start_animation, cl_tick_animation, cl_move_animation, cl_stop_animation
.global cl_play_song, cl_stop_song, cl_song_position
.global cl_play_sound, cl_tick_sound, cl_stop_sound
.global cl_hide_sprites, cl_set_sprite_count
.global cl_set_layers, cl_set_chr_banks, cl_set_scroll, cl_set_viewport
.global cl_wait_tick, cl_read_pad, cl_key_held

; ---------------------------------------------------------------------------
; Argument helpers
; ---------------------------------------------------------------------------

.macro cl__asset asset
        lda #<(asset)
        ldx #>(asset)
.endmacro
.macro cl__byte dst, arg
        lda arg
        sta dst
.endmacro
.macro cl__word dst, arg
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
.macro cl__long dst, arg
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
        cl__asset asset
        jsr cl_load
    .else
        cl__long cl_a0, location
        cl__asset asset
        jsr cl_load_at
    .endif
.endmacro
; LoadStart asset[, location]: starts a load into MIA RAM and returns at once;
; poll LoadBusy (A = 0 once done), then LoadWait for the result. A load into
; a bank finishes before LoadStart returns.
.macro LoadStart asset, location
    .ifblank location
        cl__asset asset
        jsr cl_load_start
    .else
        cl__long cl_a0, location
        cl__asset asset
        jsr cl_load_start_at
    .endif
.endmacro
.macro LoadBusy
        jsr cl_load_busy
.endmacro
.macro LoadWait
        jsr cl_load_wait
.endmacro
; LoadPart asset, offset, length, location: length bytes from offset in the file.
.macro LoadPart asset, offset, length, location
        cl__long cl_a0, offset
        cl__long cl_a3, length
        cl__long cl_a6, location
        cl__asset asset
        jsr cl_load_part
.endmacro
; Relocate asset, location: moves the loaded asset there.
.macro Relocate asset, location
        cl__long cl_a0, location
        cl__asset asset
        jsr cl_relocate
.endmacro
; Forget asset: marks it not loaded.
.macro Forget asset
        cl__asset asset
        jsr cl_forget
.endmacro

; ---------------------------------------------------------------------------
; Palettes and tilesets
; ---------------------------------------------------------------------------

; UsePalettes config: copies all 16 banks into palette RAM.
.macro UsePalettes config
        cl__asset config
        jsr cl_use_palettes
.endmacro
; UsePaletteBank config, bank[, target]: one bank, into bank target (default: the same).
.macro UsePaletteBank config, bank, target
        cl__byte cl_a0, bank
    .ifblank target
        sta cl_a1
    .else
        cl__byte cl_a1, target
    .endif
        cl__asset config
        jsr cl_use_palette_bank
.endmacro
; UseTileset tileset, chrBank: copies it into the CHR bank and sets the
; bank's 1bpp flag to match.
.macro UseTileset tileset, bank
        cl__byte cl_a0, bank
        cl__asset tileset
        jsr cl_use_tileset
.endmacro

; ---------------------------------------------------------------------------
; Backgrounds. Map coordinates are 16-bit; tables are 0-7, 40 x 25 cells.
; ---------------------------------------------------------------------------

; DrawScreen bg, col, row, table: the 40 x 25 cells from (col, row), or as
; many as the map has, to the table's top left.
.macro DrawScreen bg, col, row, table
        cl__word cl_a0, col
        cl__word cl_a2, row
        cl__byte cl_a6, table
        cl__asset bg
        jsr cl_draw_screen
.endmacro
; DrawRect bg, col, row, width, height, table, tcol, trow
.macro DrawRect bg, col, row, width, height, table, tcol, trow
        cl__word cl_a0, col
        cl__word cl_a2, row
        cl__byte cl_a4, width
        cl__byte cl_a5, height
        cl__byte cl_a6, table
        cl__byte cl_a7, tcol
        cl__byte cl_a8, trow
        cl__asset bg
        jsr cl_draw_rect
.endmacro
; DrawColumn bg, col, row, count, table, tcol, trow: count cells down.
.macro DrawColumn bg, col, row, count, table, tcol, trow
        cl__word cl_a0, col
        cl__word cl_a2, row
        cl__byte cl_a5, count
        cl__byte cl_a6, table
        cl__byte cl_a7, tcol
        cl__byte cl_a8, trow
        cl__asset bg
        jsr cl_draw_column
.endmacro
; DrawRow bg, col, row, count, table, tcol, trow: count cells across.
.macro DrawRow bg, col, row, count, table, tcol, trow
        cl__word cl_a0, col
        cl__word cl_a2, row
        cl__byte cl_a4, count
        cl__byte cl_a6, table
        cl__byte cl_a7, tcol
        cl__byte cl_a8, trow
        cl__asset bg
        jsr cl_draw_row
.endmacro
; GetCell bg, col, row: A = tile, X = attribute, from the loaded map.
.macro GetCell bg, col, row
        cl__word cl_a0, col
        cl__word cl_a2, row
        cl__asset bg
        jsr cl_get_cell
.endmacro
; SetCell bg, col, row, tile, attr: changes the loaded map; draw it to show it.
.macro SetCell bg, col, row, tile, attr
        cl__word cl_a0, col
        cl__word cl_a2, row
        cl__byte cl_a6, tile
        cl__byte cl_a7, attr
        cl__asset bg
        jsr cl_set_cell
.endmacro
; LoadRect bg, col, row, width, height[, location]: loads that part of the
; map from the card; it becomes the window the draw routines read.
.macro LoadRect bg, col, row, width, height, location
        cl__word cl_a0, col
        cl__word cl_a2, row
        cl__word cl_a4, width
        cl__word cl_a6, height
    .ifblank location
        cl__asset bg
        jsr cl_load_rect
    .else
        cl__long cl_a8, location
        cl__asset bg
        jsr cl_load_rect_at
    .endif
.endmacro
; LoadRows bg, row, count[, location]: whole rows.
.macro LoadRows bg, row, count, location
        cl__word cl_a2, row
        cl__word cl_a6, count
    .ifblank location
        cl__asset bg
        jsr cl_load_rows
    .else
        cl__long cl_a8, location
        cl__asset bg
        jsr cl_load_rows_at
    .endif
.endmacro
; LoadColumns bg, col, count[, location]: whole columns.
.macro LoadColumns bg, col, count, location
        cl__word cl_a0, col
        cl__word cl_a4, count
    .ifblank location
        cl__asset bg
        jsr cl_load_columns
    .else
        cl__long cl_a8, location
        cl__asset bg
        jsr cl_load_columns_at
    .endif
.endmacro

; ---------------------------------------------------------------------------
; Overlays
; ---------------------------------------------------------------------------

; ShowOverlay overlay: copies it into the overlay's tables.
.macro ShowOverlay overlay
        cl__asset overlay
        jsr cl_show_overlay
.endmacro
; FillPlaceholder overlay, placeholder, tiles: writes width x height tile
; numbers from CPU memory into the shown overlay, row by row.
.macro FillPlaceholder overlay, placeholder, tiles
        cl__byte cl_a0, placeholder
        cl__word cl_a1, tiles
        cl__asset overlay
        jsr cl_fill_placeholder
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
        cl__byte cl_a0, shape
    .ifblank location
        cl__asset file
        jsr cl_load_shape
    .else
        cl__long cl_a1, location
        cl__asset file
        jsr cl_load_shape_at
    .endif
.endmacro
; LoadAnimation file, anim[, location]: one animation's frames.
.macro LoadAnimation file, anim, location
        cl__byte cl_a0, anim
    .ifblank location
        cl__asset file
        jsr cl_load_animation
    .else
        cl__long cl_a1, location
        cl__asset file
        jsr cl_load_animation_at
    .endif
.endmacro
; LoadAnimationShapes file, anim: loads the shapes a loaded animation uses
; that are not loaded yet.
.macro LoadAnimationShapes file, anim
        cl__byte cl_a0, anim
        cl__asset file
        jsr cl_load_animation_shapes
.endmacro
; ForgetShape file, shape
.macro ForgetShape file, shape
        cl__byte cl_a0, shape
        cl__asset file
        jsr cl_forget_shape
.endmacro
; DrawShape file, shape, sprite, x, y[, flips]: writes the shape's sprites
; from record sprite on, with its origin at (x, y). flips: bit 0 mirrors it
; left to right, bit 1 top to bottom. A = the next free sprite record.
.macro DrawShape file, shape, sprite, xpos, ypos, flips
        cl__byte cl_a0, shape
        cl__byte cl_a1, sprite
        cl__word cl_a2, xpos
        cl__word cl_a4, ypos
    .ifblank flips
        stz cl_a6
    .else
        cl__byte cl_a6, flips
    .endif
        cl__asset file
        jsr cl_draw_shape
.endmacro
; StartAnimation inst, file, anim, sprite, x, y: shows frame 0.
.macro StartAnimation inst, file, anim, sprite, xpos, ypos
        lda #<(file)
        sta cl_a0
        lda #>(file)
        sta cl_a1
        cl__byte cl_a2, anim
        cl__byte cl_a3, sprite
        cl__word cl_a4, xpos
        cl__word cl_a6, ypos
        cl__asset inst
        jsr cl_start_animation
.endmacro
; TickAnimation inst: one tick; A has CL_TICK_FRAME set when the frame
; changed, and CL_TICK_WRAP when it went back to frame 0.
.macro TickAnimation inst
        cl__asset inst
        jsr cl_tick_animation
.endmacro
; MoveAnimation inst, x, y
.macro MoveAnimation inst, xpos, ypos
        cl__word cl_a4, xpos
        cl__word cl_a6, ypos
        cl__asset inst
        jsr cl_move_animation
.endmacro
; StopAnimation inst: hides its sprites.
.macro StopAnimation inst
        cl__asset inst
        jsr cl_stop_animation
.endmacro
; HideSprites first, count: sets the disable bit of count records (0: 256).
.macro HideSprites first, count
        cl__byte cl_a0, first
        cl__byte cl_a1, count
        jsr cl_hide_sprites
.endmacro
; SetSpriteCount count: the renderer scans records 0 to count - 1 (0: 256).
.macro SetSpriteCount count
        lda count
        jsr cl_set_sprite_count
.endmacro

; ---------------------------------------------------------------------------
; Audio
; ---------------------------------------------------------------------------

; PlaySong song: starts the song's voices from the top. The song must be in
; MIA RAM. Voices the song leaves free keep doing what they were doing.
.macro PlaySong song
        cl__asset song
        jsr cl_play_song
.endmacro
; StopSong song: stops and silences the song's voices.
.macro StopSong song
        cl__asset song
        jsr cl_stop_song
.endmacro
; SongPosition voice: A/X = the voice's note index, Y = its sequencer status.
.macro SongPosition voice
        ldx voice
        jsr cl_song_position
.endmacro
; PlaySound sound, voice: takes the voice from the sequencer and plays the
; first frame; TickSound plays the next one each tick.
.macro PlaySound sound, voice
        cl__byte cl_a0, voice
        cl__asset sound
        jsr cl_play_sound
.endmacro
; TickSound voice: A = nonzero while the sound goes on. After its last frame
; the voice goes back to the sequencer.
.macro TickSound voice
        ldx voice
        jsr cl_tick_sound
.endmacro
; StopSound voice
.macro StopSound voice
        ldx voice
        jsr cl_stop_sound
.endmacro

; ---------------------------------------------------------------------------
; Video
; ---------------------------------------------------------------------------

; SetLayers mask: bit 0 background, bit 1 overlay, bit 2 sprites.
.macro SetLayers mask
        lda mask
        jsr cl_set_layers
.endmacro
; SetChrBanks bg, bgAlt, overlay, overlayAlt, sprites: the CHR bank (0-7)
; each layer draws from.
.macro SetChrBanks bg, bgalt, ov, ovalt, spr
        cl__byte cl_a0, bg
        cl__byte cl_a1, bgalt
        cl__byte cl_a2, ov
        cl__byte cl_a3, ovalt
        cl__byte cl_a4, spr
        jsr cl_set_chr_banks
.endmacro
; SetScroll x, y: the background viewport's top-left pixel.
.macro SetScroll xpos, ypos
        cl__word cl_a0, xpos
        cl__word cl_a2, ypos
        jsr cl_set_scroll
.endmacro
; SetViewport mode, set: the background plane (0-5) and table set (0-1).
.macro SetViewport mode, set
        cl__byte cl_a0, mode
        cl__byte cl_a1, set
        jsr cl_set_viewport
.endmacro

; ---------------------------------------------------------------------------
; Timing and input
; ---------------------------------------------------------------------------

; WaitTick: waits until MIA's 60 Hz count moves on from where the last
; WaitTick returned; A = the ticks since then (1-255). The first returns at once.
.macro WaitTick
        jsr cl_wait_tick
.endmacro
; ReadPad player: A = the CL_PAD_* bits held on gamepad 0-3; player 0 adds
; the keyboard's arrows, WASD, Z/Space (A), X (B), Tab (Select), Enter (Start).
.macro ReadPad player
        ldx player
        jsr cl_read_pad
.endmacro
; KeyHeld usage: A = nonzero while that Keyboard/Keypad usage is held.
.macro KeyHeld usage
        lda usage
        jsr cl_key_held
.endmacro

; ---------------------------------------------------------------------------
; Interrupt handlers
; ---------------------------------------------------------------------------

; A handler that calls library routines writes MIA_CTX_PUSH on entry, then
; LibSave; LibRestore and MIA_CTX_POP before RTI. Both use A and X.
.macro LibSave
    .local loop
        ldx #CL_STATE_SIZE-1
loop:   lda cl_state,x
        pha
        dex
        bpl loop
.endmacro
; Waits for the handler's own MIA command to finish, so the pop that follows
; can't undo a command still reading the descriptors.
.macro LibRestore
    .local wait, loop
wait:   lda $FFEA
        and #%00001100
        bne wait
        ldx #0
loop:   pla
        sta cl_state,x
        inx
        cpx #CL_STATE_SIZE
        bne loop
.endmacro

.endif
