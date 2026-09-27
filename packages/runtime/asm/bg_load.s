; Backgrounds: loading part of a map from the card. The part loaded becomes
; the map's window, which the draw routines and the cell routines read.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; LoadRows bg, row (a2/a3), count (a6/a7)[, location (a8-a10)]: whole rows.
rt_load_rows:
        jsr rows
        bra default
rt_load_rows_at:
        jsr rows
        bra at
; LoadColumns bg, col (a0/a1), count (a4/a5)[, location]: whole columns.
rt_load_columns:
        jsr columns
        bra default
rt_load_columns_at:
        jsr columns
        bra at
; LoadRect bg, col (a0/a1), row (a2/a3), width (a4/a5), height (a6/a7)[, location]
rt_load_rect:
        jsr rt_set_desc
default:
        jsr rt_desc_default
        ldx #2
:       lda rt_to,x
        sta rt_a8,x
        dex
        bpl :-
        bra load
rt_load_rect_at:
        jsr rt_set_desc
at:
.if RT_CHECKS
        ldx #rt_a8
        jsr rt_check_loc
        bcc load
        rts
.endif
load:   jsr rt_load_idle
.if RT_CHECKS
        lda rt_a4                   ; at least one cell, all inside the map
        ora rt_a5
        jeq @range
        lda rt_a6
        ora rt_a7
        jeq @range
        clc
        lda rt_a0
        adc rt_a4
        sta rt_t0
        lda rt_a1
        adc rt_a5
        jcs @range
        tax
        ldy #RT_D_WIDTH
        lda (rt_desc),y
        cmp rt_t0
        iny
        lda (rt_desc),y
        stx rt_t0
        sbc rt_t0
        jcc @range
        clc
        lda rt_a2
        adc rt_a6
        sta rt_t0
        lda rt_a3
        adc rt_a7
        jcs @range
        tax
        ldy #RT_D_HEIGHT
        lda (rt_desc),y
        cmp rt_t0
        iny
        lda (rt_desc),y
        stx rt_t0
        sbc rt_t0
        jcc @range
.endif
        ldy #RT_D_LOC               ; not loaded until both halves are in
        lda #$FF
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        jsr part                    ; tiles
        jsr rt_sd_part
        jcs @fail
        jsr part                    ; attributes: a map's worth further in the
        ldy #RT_D_WIDTH             ; file, a window's worth further in memory
        lda (rt_desc),y
        sta rt_mul
        iny
        lda (rt_desc),y
        sta rt_mul+1
        iny
        lda (rt_desc),y
        pha
        iny
        lda (rt_desc),y
        tax
        pla
        jsr rt_mul16
        clc
        lda rt_sd_off
        adc rt_prod
        sta rt_sd_off
        lda rt_sd_off+1
        adc rt_prod+1
        sta rt_sd_off+1
        lda rt_sd_off+2
        adc rt_prod+2
        sta rt_sd_off+2
        lda rt_a4
        sta rt_mul
        lda rt_a5
        sta rt_mul+1
        lda rt_a6
        ldx rt_a7
        jsr rt_mul16
        ldx #2
:       lda rt_a8,x
        sta rt_loc,x
        dex
        bpl :-
        ldx #rt_loc
        jsr rt_add_loc
        ldx #2
:       lda rt_loc,x
        sta rt_sd_dest,x
        dex
        bpl :-
        jsr rt_sd_part
        bcs @fail
        ldx #2                      ; loaded: the location and the window
:       lda rt_a8,x
        sta rt_to,x
        dex
        bpl :-
        jsr rt_set_desc_loc
        ldy #RT_D_WIN_COL
        ldx #0
:       lda rt_a0,x
        sta (rt_desc),y
        iny
        inx
        cpx #8
        bne :-
        clc
        rts
@range: lda #RT_ERR_RANGE
        jmp rt_fail
@fail:  rts

; The tiles' transfer: from row * width + col, width cells a row, rows map
; columns apart in the file and window columns apart in memory. Whole rows
; are one run.
part:   lda rt_a2
        sta rt_mul
        lda rt_a3
        sta rt_mul+1
        ldy #RT_D_WIDTH
        lda (rt_desc),y
        pha
        iny
        lda (rt_desc),y
        tax
        pla
        jsr rt_mul16
        clc
        lda rt_prod
        adc rt_a0
        sta rt_sd_off
        lda rt_prod+1
        adc rt_a1
        sta rt_sd_off+1
        lda rt_prod+2
        adc #0
        sta rt_sd_off+2
        ldx #2
:       lda rt_a8,x
        sta rt_sd_dest,x
        dex
        bpl :-
        ldy #RT_D_WIDTH             ; whole rows?
        lda (rt_desc),y
        cmp rt_a4
        bne @rect
        iny
        lda (rt_desc),y
        cmp rt_a5
        bne @rect
        lda rt_a4                   ; one run of width x height
        sta rt_mul
        lda rt_a5
        sta rt_mul+1
        lda rt_a6
        ldx rt_a7
        jsr rt_mul16
        ldx #2
:       lda rt_prod,x
        sta rt_sd_rowlen,x
        stz rt_sd_fstride,x
        stz rt_sd_dstride,x
        dex
        bpl :-
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
        rts
@rect:  lda rt_a4
        sta rt_sd_rowlen
        sta rt_sd_dstride
        lda rt_a5
        sta rt_sd_rowlen+1
        sta rt_sd_dstride+1
        stz rt_sd_rowlen+2
        stz rt_sd_dstride+2
        lda rt_a6
        sta rt_sd_rows
        lda rt_a7
        sta rt_sd_rows+1
        ldy #RT_D_WIDTH
        lda (rt_desc),y
        sta rt_sd_fstride
        iny
        lda (rt_desc),y
        sta rt_sd_fstride+1
        stz rt_sd_fstride+2
        rts

; Whole rows: from column 0, the map's width.
rows:   jsr rt_set_desc
        stz rt_a0
        stz rt_a1
        ldy #RT_D_WIDTH
        lda (rt_desc),y
        sta rt_a4
        iny
        lda (rt_desc),y
        sta rt_a5
        rts
; Whole columns: from row 0, the map's height.
columns:
        jsr rt_set_desc
        stz rt_a2
        stz rt_a3
        ldy #RT_D_HEIGHT
        lda (rt_desc),y
        sta rt_a6
        iny
        lda (rt_desc),y
        sta rt_a7
        rts
