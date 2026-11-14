; Render control: layers, CHR banks, scroll and the background plane.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; SetLayers mask (A): bit 0 background, bit 1 overlay, bit 2 sprites.
cl_set_layers:
        pha
        lda #<MIA_VIDEO_LAYER_ENABLE_OFFSET
        jsr at
        pla
        jmp cl_poke

; SetChrBanks bg, bgAlt, overlay, overlayAlt, sprites (a0-a4)
cl_set_chr_banks:
        lda #<MIA_VIDEO_BG_CHR_BANK_OFFSET
        ldx #5
        bra write

; SetScroll x (a0/a1), y (a2/a3)
cl_set_scroll:
        lda #<MIA_VIDEO_SCROLL_X_OFFSET
        ldx #4
        bra write

; SetViewport mode (a0), set (a1)
cl_set_viewport:
        lda #<MIA_VIDEO_BG_VIEWPORT_MODE_OFFSET
        ldx #2
; A = render control offset, X = bytes from cl_a0 on.
write:  phx
        jsr at
        ldx #cl_to
        lda #(1 << IDX_FLAG_W_STP_ENA)
        jsr cl_seek_b
        plx
        ldy #0
:       lda cl_a0,y
        sta IDXB_PORT
        iny
        dex
        bne :-
        clc
        rts

; cl_to = render control byte A.
at:     sta cl_to
        stz cl_to+1
        stz cl_to+2
        rts
