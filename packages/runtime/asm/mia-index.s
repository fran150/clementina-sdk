; MIA index-window setup and single-byte access. The two windows have
; different register IDs, so their otherwise similar setup is explicit.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; ---------------------------------------------------------------------------
; Index windows. X = the zero-page address of a 3-byte MIA address, A = the
; index flags. The step becomes 1; the address goes last, since each
; address byte refreshes the window's port. Keep X.
; ---------------------------------------------------------------------------
rt_seek_a:
        jsr rt_wait
        pha
        lda #RT_IDX_A
        sta IDXA_SELECT
        lda #CFG_A_FLAGS
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #1
        ldy #0
        jsr rt_step_a
        lda #CFG_A_ADDR+2
        sta CFG_SELECT
        lda 2,x
        sta CFG_PORT
        lda #CFG_A_ADDR+1
        sta CFG_SELECT
        lda 1,x
        sta CFG_PORT
        lda #CFG_A_ADDR
        sta CFG_SELECT
        lda 0,x
        sta CFG_PORT
        rts

rt_seek_b:
        jsr rt_wait
        pha
        lda #RT_IDX_B
        sta IDXB_SELECT
        lda #CFG_B_FLAGS
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #1
        ldy #0
        jsr rt_step_b
        lda #CFG_B_ADDR+2
        sta CFG_SELECT
        lda 2,x
        sta CFG_PORT
        lda #CFG_B_ADDR+1
        sta CFG_SELECT
        lda 1,x
        sta CFG_PORT
        lda #CFG_B_ADDR
        sta CFG_SELECT
        lda 0,x
        sta CFG_PORT
        rts

; A = step low, Y = step high, for the index in window A or B.
rt_step_a:
        pha
        lda #CFG_A_STEP
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #CFG_A_STEP+1
        sta CFG_SELECT
        sty CFG_PORT
        rts
rt_step_b:
        pha
        lda #CFG_B_STEP
        sta CFG_SELECT
        pla
        sta CFG_PORT
        lda #CFG_B_STEP+1
        sta CFG_SELECT
        sty CFG_PORT
        rts

; X = the zero-page address of window A's 3-byte limit.
rt_limit_a:
        lda #CFG_A_LIMIT+2
        sta CFG_SELECT
        lda 2,x
        sta CFG_PORT
        lda #CFG_A_LIMIT+1
        sta CFG_SELECT
        lda 1,x
        sta CFG_PORT
        lda #CFG_A_LIMIT
        sta CFG_SELECT
        lda 0,x
        sta CFG_PORT
        rts

; A = value, written at the MIA address in rt_to.
rt_poke:
        pha
        ldx #rt_to
        lda #0
        jsr rt_seek_b
        pla
        sta IDXB_PORT
        clc
        rts
; A = the byte at the MIA address in rt_loc.
rt_peek:
        ldx #rt_loc
        lda #0
        jsr rt_seek_a
        lda IDXA_PORT
        rts
