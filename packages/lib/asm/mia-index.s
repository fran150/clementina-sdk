; MIA index-window setup and single-byte access. The two windows have
; different register IDs, so their otherwise similar setup is explicit.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; ---------------------------------------------------------------------------
; Index windows. X = the zero-page address of a 3-byte MIA address, A = the
; index flags. The step becomes 1; the address goes last, since each
; address byte refreshes the window's port. Keep X.
; ---------------------------------------------------------------------------
cl_seek_a:
        jsr cl_wait
        pha
        lda #CL_IDX_A
        sta IDXA_SELECT
        lda #CFG_IDXA_FLAGS
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #1
        ldy #0
        jsr cl_step_a
        lda #CFG_IDXA_ADDR_L+2
        sta CFG_SELECT
        lda 2,x
        sta CFG_PORT
        lda #CFG_IDXA_ADDR_L+1
        sta CFG_SELECT
        lda 1,x
        sta CFG_PORT
        lda #CFG_IDXA_ADDR_L
        sta CFG_SELECT
        lda 0,x
        sta CFG_PORT
        rts

cl_seek_b:
        jsr cl_wait
        pha
        lda #CL_IDX_B
        sta IDXB_SELECT
        lda #CFG_IDXB_FLAGS
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #1
        ldy #0
        jsr cl_step_b
        lda #CFG_IDXB_ADDR_L+2
        sta CFG_SELECT
        lda 2,x
        sta CFG_PORT
        lda #CFG_IDXB_ADDR_L+1
        sta CFG_SELECT
        lda 1,x
        sta CFG_PORT
        lda #CFG_IDXB_ADDR_L
        sta CFG_SELECT
        lda 0,x
        sta CFG_PORT
        rts

; A = step low, Y = step high, for the index in window A or B.
cl_step_a:
        pha
        lda #CFG_IDXA_STP_L
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #CFG_IDXA_STP_L+1
        sta CFG_SELECT
        sty CFG_PORT
        rts
cl_step_b:
        pha
        lda #CFG_IDXB_STP_L
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #CFG_IDXB_STP_L+1
        sta CFG_SELECT
        sty CFG_PORT
        rts

; X = the zero-page address of window A's 3-byte limit.
cl_limit_a:
        lda #CFG_IDXA_LIM_L+2
        sta CFG_SELECT
        lda 2,x
        sta CFG_PORT
        lda #CFG_IDXA_LIM_L+1
        sta CFG_SELECT
        lda 1,x
        sta CFG_PORT
        lda #CFG_IDXA_LIM_L
        sta CFG_SELECT
        lda 0,x
        sta CFG_PORT
        rts

; A = value, written at the MIA address in cl_to.
cl_poke:
        pha
        ldx #cl_to
        lda #0
        jsr cl_seek_b
        pla
        sta IDXB_PORT
        clc
        rts
; A = the byte at the MIA address in cl_loc.
cl_peek:
        ldx #cl_loc
        lda #0
        jsr cl_seek_a
        lda IDXA_PORT
        rts
