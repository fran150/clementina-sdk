; Backgrounds: loading part of a map from the card. The part loaded becomes
; the map's window, which the draw routines and the cell routines read.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; LoadRows bg, row (a2/a3), count (a6/a7)[, location (a8-a10)]: whole rows.
cl_load_rows:
        jsr rows
        bra default
cl_load_rows_at:
        jsr rows
        bra at
; LoadColumns bg, col (a0/a1), count (a4/a5)[, location]: whole columns.
cl_load_columns:
        jsr columns
        bra default
cl_load_columns_at:
        jsr columns
        bra at
; LoadRect bg, col (a0/a1), row (a2/a3), width (a4/a5), height (a6/a7)[, location]
cl_load_rect:
        jsr cl_set_desc
default:
        jsr cl_desc_default
        ldx #2
:       lda cl_to,x
        sta cl_a8,x
        dex
        bpl :-
        bra load
cl_load_rect_at:
        jsr cl_set_desc
at:
.if CL_CHECKS
        ldx #cl_a8
        jsr cl_check_loc
        bcc load
        rts
.endif
load:   jsr cl_load_idle
.if CL_CHECKS
        lda cl_a4                   ; at least one cell, all inside the map
        ora cl_a5
        jeq @range
        lda cl_a6
        ora cl_a7
        jeq @range
        clc
        lda cl_a0
        adc cl_a4
        sta cl_t0
        lda cl_a1
        adc cl_a5
        jcs @range
        tax
        ldy #CL_D_WIDTH
        lda (cl_desc),y
        cmp cl_t0
        iny
        lda (cl_desc),y
        stx cl_t0
        sbc cl_t0
        jcc @range
        clc
        lda cl_a2
        adc cl_a6
        sta cl_t0
        lda cl_a3
        adc cl_a7
        jcs @range
        tax
        ldy #CL_D_HEIGHT
        lda (cl_desc),y
        cmp cl_t0
        iny
        lda (cl_desc),y
        stx cl_t0
        sbc cl_t0
        jcc @range
.endif
        ldy #CL_D_LOC               ; not loaded until both halves are in
        lda #$FF
        sta (cl_desc),y
        iny
        sta (cl_desc),y
        iny
        sta (cl_desc),y
        jsr part                    ; tiles
        jsr cl_sd_part
        jcs @fail
        jsr part                    ; attributes: a map's worth further in the
        ldy #CL_D_WIDTH             ; file, a window's worth further in memory
        lda (cl_desc),y
        sta cl_mul
        iny
        lda (cl_desc),y
        sta cl_mul+1
        iny
        lda (cl_desc),y
        pha
        iny
        lda (cl_desc),y
        tax
        pla
        jsr cl_mul16
        clc
        lda cl_sd_off
        adc cl_prod
        sta cl_sd_off
        lda cl_sd_off+1
        adc cl_prod+1
        sta cl_sd_off+1
        lda cl_sd_off+2
        adc cl_prod+2
        sta cl_sd_off+2
        lda cl_a4
        sta cl_mul
        lda cl_a5
        sta cl_mul+1
        lda cl_a6
        ldx cl_a7
        jsr cl_mul16
        ldx #2
:       lda cl_a8,x
        sta cl_loc,x
        dex
        bpl :-
        ldx #cl_loc
        jsr cl_add_loc
        ldx #2
:       lda cl_loc,x
        sta cl_sd_dest,x
        dex
        bpl :-
        jsr cl_sd_part
        bcs @fail
        ldx #2                      ; loaded: the location and the window
:       lda cl_a8,x
        sta cl_to,x
        dex
        bpl :-
        jsr cl_set_desc_loc
        ldy #CL_D_WIN_COL
        ldx #0
:       lda cl_a0,x
        sta (cl_desc),y
        iny
        inx
        cpx #8
        bne :-
        clc
        rts
@range: lda #CL_ERR_RANGE
        jmp cl_fail
@fail:  rts

; The tiles' transfer: from row * width + col, width cells a row, rows map
; columns apart in the file and window columns apart in memory. Whole rows
; are one run.
part:   lda cl_a2
        sta cl_mul
        lda cl_a3
        sta cl_mul+1
        ldy #CL_D_WIDTH
        lda (cl_desc),y
        pha
        iny
        lda (cl_desc),y
        tax
        pla
        jsr cl_mul16
        clc
        lda cl_prod
        adc cl_a0
        sta cl_sd_off
        lda cl_prod+1
        adc cl_a1
        sta cl_sd_off+1
        lda cl_prod+2
        adc #0
        sta cl_sd_off+2
        ldx #2
:       lda cl_a8,x
        sta cl_sd_dest,x
        dex
        bpl :-
        ldy #CL_D_WIDTH             ; whole rows?
        lda (cl_desc),y
        cmp cl_a4
        bne @rect
        iny
        lda (cl_desc),y
        cmp cl_a5
        bne @rect
        lda cl_a4                   ; one run of width x height
        sta cl_mul
        lda cl_a5
        sta cl_mul+1
        lda cl_a6
        ldx cl_a7
        jsr cl_mul16
        ldx #2
:       lda cl_prod,x
        sta cl_sd_rowlen,x
        stz cl_sd_fstride,x
        stz cl_sd_dstride,x
        dex
        bpl :-
        lda #1
        sta cl_sd_rows
        stz cl_sd_rows+1
        rts
@rect:  lda cl_a4
        sta cl_sd_rowlen
        sta cl_sd_dstride
        lda cl_a5
        sta cl_sd_rowlen+1
        sta cl_sd_dstride+1
        stz cl_sd_rowlen+2
        stz cl_sd_dstride+2
        lda cl_a6
        sta cl_sd_rows
        lda cl_a7
        sta cl_sd_rows+1
        ldy #CL_D_WIDTH
        lda (cl_desc),y
        sta cl_sd_fstride
        iny
        lda (cl_desc),y
        sta cl_sd_fstride+1
        stz cl_sd_fstride+2
        rts

; Whole rows: from column 0, the map's width.
rows:   jsr cl_set_desc
        stz cl_a0
        stz cl_a1
        ldy #CL_D_WIDTH
        lda (cl_desc),y
        sta cl_a4
        iny
        lda (cl_desc),y
        sta cl_a5
        rts
; Whole columns: from row 0, the map's height.
columns:
        jsr cl_set_desc
        stz cl_a2
        stz cl_a3
        ldy #CL_D_HEIGHT
        lda (cl_desc),y
        sta cl_a6
        iny
        lda (cl_desc),y
        sta cl_a7
        rts
