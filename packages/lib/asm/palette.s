; Palette configurations: 16 banks x 8 RGB565 colors, palette RAM's layout.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; UsePalettes config: all 16 banks into palette RAM, unless it is loaded there.
cl_use_palettes:
        jsr cl_set_desc
        jsr cl_desc_loc
        bcs @fail
        lda #<MIA_VIDEO_PALETTE_OFFSET
        sta cl_to
        lda #>MIA_VIDEO_PALETTE_OFFSET
        sta cl_to+1
        stz cl_to+2
        jsr cl_loc_equals_to
        beq @done
        stz cl_len
        lda #1
        sta cl_len+1
        stz cl_len+2
        jmp cl_copy
@done:  clc
@fail:  rts

; UsePaletteBank config, bank (cl_a0), target (cl_a1): 16 bytes.
cl_use_palette_bank:
        jsr cl_set_desc
.if CL_CHECKS
        lda cl_a0
        ora cl_a1
        cmp #16
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        jsr cl_desc_loc
        bcs @fail
        lda cl_a0                   ; the bank in the configuration
        asl a
        asl a
        asl a
        asl a
        sta cl_prod
        stz cl_prod+1
        stz cl_prod+2
        ldx #cl_loc
        jsr cl_add_loc
        lda cl_a1                   ; the bank in palette RAM
        asl a
        asl a
        asl a
        asl a
        sta cl_to
        lda #>MIA_VIDEO_PALETTE_OFFSET
        sta cl_to+1
        stz cl_to+2
        lda #16
        sta cl_len
        stz cl_len+1
        stz cl_len+2
        jmp cl_copy
@fail:  rts
