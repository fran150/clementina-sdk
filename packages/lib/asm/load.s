; Whole-asset loads and their asynchronous job state. SD transfer mechanics
; live in sd-load.s. Loads are not interrupt-safe.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "BSS"
job_desc:      .res 2       ; the asset LoadStart left loading; high byte 0: none
job_dest:      .res 3       ; and where to

.segment "CODE"

; ---------------------------------------------------------------------------
; Whole assets
; ---------------------------------------------------------------------------

; Load asset[, location]
cl_load:
        jsr cl_load_start
        jcc cl_load_wait
        rts
cl_load_at:
        jsr cl_load_start_at
        jcc cl_load_wait
        rts

; LoadStart asset[, location]
cl_load_start:
        jsr cl_set_desc
        jsr cl_load_idle
        jsr cl_desc_default
        bra start_whole_asset
cl_load_start_at:
        jsr cl_set_desc
        jsr cl_load_idle
        lda cl_a0
        sta cl_to
        lda cl_a1
        sta cl_to+1
        lda cl_a2
        sta cl_to+2
.if CL_CHECKS
        ldx #cl_to
        jsr cl_check_loc
        bcc start_whole_asset
        rts
.endif
start_whole_asset:  ldx #2                      ; the whole file is one row
@whole: stz cl_sd_off,x
        stz cl_sd_fstride,x
        stz cl_sd_dstride,x
        lda cl_to,x
        sta cl_sd_dest,x
        dex
        bpl @whole
        ldy #CL_D_SIZE
        lda (cl_desc),y
        sta cl_sd_rowlen
        iny
        lda (cl_desc),y
        sta cl_sd_rowlen+1
        iny
        lda (cl_desc),y
        sta cl_sd_rowlen+2
        lda #1
        sta cl_sd_rows
        stz cl_sd_rows+1
        ldy #CL_D_LOC               ; not loaded while the load runs
        lda #$FF
        sta (cl_desc),y
        iny
        sta (cl_desc),y
        iny
        sta (cl_desc),y
        lda cl_to+2
        bmi @bank
        jsr cl_mia_part                ; into MIA RAM: runs on its own
        bcs @fail
        lda cl_desc
        sta job_desc
        lda cl_desc+1
        sta job_desc+1
        ldx #2
:       lda cl_to,x
        sta job_dest,x
        dex
        bpl :-
        clc
        rts
@bank:  ldx #2                      ; cl_bank_part advances its destination
:       lda cl_to,x
        sta job_dest,x
        dex
        bpl :-
        jsr cl_bank_part
        bcs @fail
        ldx #2
:       lda job_dest,x
        sta cl_to,x
        dex
        bpl :-
        jmp finish_whole_asset
@fail:  rts

; Finishes the load LoadStart began, if there is one, keeping cl_desc,
; cl_to and the arguments: the card runs one job at a time, and the
; cl_sd_* variables describe the running one. Every load calls this first.
cl_load_idle:
        lda job_desc+1
        beq @none
        lda cl_desc
        pha
        lda cl_desc+1
        pha
        ldx #2
:       lda cl_to,x
        pha
        dex
        bpl :-
        jsr cl_load_wait
        ldx #0
:       pla
        sta cl_to,x
        inx
        cpx #3
        bne :-
        pla
        sta cl_desc+1
        pla
        sta cl_desc
@none:  rts

; LoadBusy: A = nonzero while the load LoadStart began is still running.
cl_load_busy:
        lda job_desc+1
        beq @idle
        lda STATUS_H
        and #>MIA_STAT_SD_BUSY
@idle:  rts

; LoadWait: waits for the load LoadStart began and returns its result;
; without one, succeeds at once.
cl_load_wait:
        lda job_desc+1
        bne @job
        clc
        rts
@job:   sta cl_desc+1
        lda job_desc
        sta cl_desc
        stz job_desc+1
        ldy #CL_D_SIZE              ; the whole file should have arrived
        ldx #0
:       lda (cl_desc),y
        sta cl_sd_rowlen,x
        iny
        inx
        cpx #3
        bne :-
        lda #1
        sta cl_sd_rows
        stz cl_sd_rows+1
        jsr cl_check_part              ; waits, then checks the error and the count
        bcs @fail
        ldx #2
:       lda job_dest,x
        sta cl_to,x
        dex
        bpl :-
        jmp finish_whole_asset
@fail:  rts

; The asset is now at cl_to: its location, a background's window (all of
; it) and a sprite file's items.
finish_whole_asset:
        jsr cl_set_desc_loc
        ldy #CL_D_TYPE
        lda (cl_desc),y
        cmp #CL_BACKGROUND
        beq @map
        cmp #CL_SPRITES
        beq @items
        clc
        rts
@map:   ldy #CL_D_WIDTH             ; window = columns 0.., rows 0.., the whole map
        ldx #4
:       lda (cl_desc),y
        pha
        iny
        dex
        bne :-
        ldy #CL_D_WIN_ROWS+1
        ldx #4
:       pla
        sta (cl_desc),y
        dey
        dex
        bne :-
        lda #0
        ldy #CL_D_WIN_COL
:       sta (cl_desc),y
        iny
        cpy #CL_D_WIN_COLS
        bne :-
        clc
        rts
@items: ldx #<place_loaded_item             ; each item is at cl_to plus its offset
        ldy #>place_loaded_item
        jmp cl_items_each

place_loaded_item:
        ldy #0
        lda (cl_ptr),y
        sta cl_prod
        iny
        lda (cl_ptr),y
        sta cl_prod+1
        iny
        lda (cl_ptr),y
        sta cl_prod+2
        ldx #2
:       lda cl_to,x
        sta cl_loc,x
        dex
        bpl :-
        ldx #cl_loc
        jsr cl_add_loc
        ldy #2
:       lda cl_loc,y
        sta (cl_cpu),y
        dey
        bpl :-
        rts

; ---------------------------------------------------------------------------
; LoadPart asset, offset, length, location: cl_a0-a2, cl_a3-a5, cl_a6-a8.
; ---------------------------------------------------------------------------
cl_load_part:
        jsr cl_set_desc
        jsr cl_load_idle
        ldx #2
:       lda cl_a0,x
        sta cl_sd_off,x
        lda cl_a3,x
        sta cl_sd_rowlen,x
        lda cl_a6,x
        sta cl_sd_dest,x
        stz cl_sd_fstride,x
        stz cl_sd_dstride,x
        dex
        bpl :-
        lda #1
        sta cl_sd_rows
        stz cl_sd_rows+1
.if CL_CHECKS
        lda cl_a6
        sta cl_to
        lda cl_a7
        sta cl_to+1
        lda cl_a8
        sta cl_to+2
        ldx #cl_to
        jsr cl_check_loc
        bcs @fail
.endif
        jmp cl_sd_part
@fail:  rts
