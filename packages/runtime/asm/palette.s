; Palette configurations: 16 banks x 8 RGB565 colors, palette RAM's layout.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; UsePalettes config: all 16 banks into palette RAM, unless it is loaded there.
rt_use_palettes:
        jsr rt_set_desc
        jsr rt_desc_loc
        bcs @fail
        lda #<MIA_PALETTES
        sta rt_to
        lda #>MIA_PALETTES
        sta rt_to+1
        stz rt_to+2
        jsr rt_loc_equals_to
        beq @done
        stz rt_len
        lda #1
        sta rt_len+1
        stz rt_len+2
        jmp rt_copy
@done:  clc
@fail:  rts

; UsePaletteBank config, bank (rt_a0), target (rt_a1): 16 bytes.
rt_use_palette_bank:
        jsr rt_set_desc
.if RT_CHECKS
        lda rt_a0
        ora rt_a1
        cmp #16
        bcc :+
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        jsr rt_desc_loc
        bcs @fail
        lda rt_a0                   ; the bank in the configuration
        asl a
        asl a
        asl a
        asl a
        sta rt_prod
        stz rt_prod+1
        stz rt_prod+2
        ldx #rt_loc
        jsr rt_add_loc
        lda rt_a1                   ; the bank in palette RAM
        asl a
        asl a
        asl a
        asl a
        sta rt_to
        lda #>MIA_PALETTES
        sta rt_to+1
        stz rt_to+2
        lda #16
        sta rt_len
        stz rt_len+1
        stz rt_len+2
        jmp rt_copy
@fail:  rts
