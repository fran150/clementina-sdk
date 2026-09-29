; Whole-asset loads and their asynchronous job state. SD transfer mechanics
; live in sd-load.s. Loads are not interrupt-safe.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "BSS"
job_desc:      .res 2       ; the asset LoadStart left loading; high byte 0: none
job_dest:      .res 3       ; and where to

.segment "CODE"

; ---------------------------------------------------------------------------
; Whole assets
; ---------------------------------------------------------------------------

; Load asset[, location]
rt_load:
        jsr rt_load_start
        jcc rt_load_wait
        rts
rt_load_at:
        jsr rt_load_start_at
        jcc rt_load_wait
        rts

; LoadStart asset[, location]
rt_load_start:
        jsr rt_set_desc
        jsr rt_load_idle
        jsr rt_desc_default
        bra start_whole_asset
rt_load_start_at:
        jsr rt_set_desc
        jsr rt_load_idle
        lda rt_a0
        sta rt_to
        lda rt_a1
        sta rt_to+1
        lda rt_a2
        sta rt_to+2
.if RT_CHECKS
        ldx #rt_to
        jsr rt_check_loc
        bcc start_whole_asset
        rts
.endif
start_whole_asset:  ldx #2                      ; the whole file is one row
@whole: stz rt_sd_off,x
        stz rt_sd_fstride,x
        stz rt_sd_dstride,x
        lda rt_to,x
        sta rt_sd_dest,x
        dex
        bpl @whole
        ldy #RT_D_SIZE
        lda (rt_desc),y
        sta rt_sd_rowlen
        iny
        lda (rt_desc),y
        sta rt_sd_rowlen+1
        iny
        lda (rt_desc),y
        sta rt_sd_rowlen+2
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
        ldy #RT_D_LOC               ; not loaded while the load runs
        lda #$FF
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        lda rt_to+2
        bmi @bank
        jsr rt_mia_part                ; into MIA RAM: runs on its own
        bcs @fail
        lda rt_desc
        sta job_desc
        lda rt_desc+1
        sta job_desc+1
        ldx #2
:       lda rt_to,x
        sta job_dest,x
        dex
        bpl :-
        clc
        rts
@bank:  ldx #2                      ; rt_bank_part advances its destination
:       lda rt_to,x
        sta job_dest,x
        dex
        bpl :-
        jsr rt_bank_part
        bcs @fail
        ldx #2
:       lda job_dest,x
        sta rt_to,x
        dex
        bpl :-
        jmp finish_whole_asset
@fail:  rts

; Finishes the load LoadStart began, if there is one, keeping rt_desc,
; rt_to and the arguments: the card runs one job at a time, and the
; rt_sd_* variables describe the running one. Every load calls this first.
rt_load_idle:
        lda job_desc+1
        beq @none
        lda rt_desc
        pha
        lda rt_desc+1
        pha
        ldx #2
:       lda rt_to,x
        pha
        dex
        bpl :-
        jsr rt_load_wait
        ldx #0
:       pla
        sta rt_to,x
        inx
        cpx #3
        bne :-
        pla
        sta rt_desc+1
        pla
        sta rt_desc
@none:  rts

; LoadBusy: A = nonzero while the load LoadStart began is still running.
rt_load_busy:
        lda job_desc+1
        beq @idle
        lda STATUS_H
        and #STH_SD_BUSY
@idle:  rts

; LoadWait: waits for the load LoadStart began and returns its result;
; without one, succeeds at once.
rt_load_wait:
        lda job_desc+1
        bne @job
        clc
        rts
@job:   sta rt_desc+1
        lda job_desc
        sta rt_desc
        stz job_desc+1
        ldy #RT_D_SIZE              ; the whole file should have arrived
        ldx #0
:       lda (rt_desc),y
        sta rt_sd_rowlen,x
        iny
        inx
        cpx #3
        bne :-
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
        jsr rt_check_part              ; waits, then checks the error and the count
        bcs @fail
        ldx #2
:       lda job_dest,x
        sta rt_to,x
        dex
        bpl :-
        jmp finish_whole_asset
@fail:  rts

; The asset is now at rt_to: its location, a background's window (all of
; it) and a sprite file's items.
finish_whole_asset:
        jsr rt_set_desc_loc
        ldy #RT_D_TYPE
        lda (rt_desc),y
        cmp #RT_BACKGROUND
        beq @map
        cmp #RT_SPRITES
        beq @items
        clc
        rts
@map:   ldy #RT_D_WIDTH             ; window = columns 0.., rows 0.., the whole map
        ldx #4
:       lda (rt_desc),y
        pha
        iny
        dex
        bne :-
        ldy #RT_D_WIN_ROWS+1
        ldx #4
:       pla
        sta (rt_desc),y
        dey
        dex
        bne :-
        lda #0
        ldy #RT_D_WIN_COL
:       sta (rt_desc),y
        iny
        cpy #RT_D_WIN_COLS
        bne :-
        clc
        rts
@items: ldx #<place_loaded_item             ; each item is at rt_to plus its offset
        ldy #>place_loaded_item
        jmp rt_items_each

place_loaded_item:
        ldy #0
        lda (rt_ptr),y
        sta rt_prod
        iny
        lda (rt_ptr),y
        sta rt_prod+1
        iny
        lda (rt_ptr),y
        sta rt_prod+2
        ldx #2
:       lda rt_to,x
        sta rt_loc,x
        dex
        bpl :-
        ldx #rt_loc
        jsr rt_add_loc
        ldy #2
:       lda rt_loc,y
        sta (rt_cpu),y
        dey
        bpl :-
        rts

; ---------------------------------------------------------------------------
; LoadPart asset, offset, length, location: rt_a0-a2, rt_a3-a5, rt_a6-a8.
; ---------------------------------------------------------------------------
rt_load_part:
        jsr rt_set_desc
        jsr rt_load_idle
        ldx #2
:       lda rt_a0,x
        sta rt_sd_off,x
        lda rt_a3,x
        sta rt_sd_rowlen,x
        lda rt_a6,x
        sta rt_sd_dest,x
        stz rt_sd_fstride,x
        stz rt_sd_dstride,x
        dex
        bpl :-
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
.if RT_CHECKS
        lda rt_a6
        sta rt_to
        lda rt_a7
        sta rt_to+1
        lda rt_a8
        sta rt_to+2
        ldx #rt_to
        jsr rt_check_loc
        bcs @fail
.endif
        jmp rt_sd_part
@fail:  rts
