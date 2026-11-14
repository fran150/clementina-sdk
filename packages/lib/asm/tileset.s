; Tilesets: one CHR bank, 6,144 bytes.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; UseTileset tileset, chrBank (cl_a0): copies it into the bank unless it is
; loaded there, then sets the bank's bit in CHR_1BPP_MASK to the tileset's mode.
cl_use_tileset:
        jsr cl_set_desc
.if CL_CHECKS
        lda cl_a0
        cmp #8
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        jsr cl_desc_loc
        bcs @fail
        jsr bank_address
        jsr cl_loc_equals_to       ; already in the requested CHR bank?
        beq @mode
        stz cl_len
        lda #>6144
        sta cl_len+1
        stz cl_len+2
        jsr cl_copy
@mode:  lda #<MIA_VIDEO_CHR_1BPP_MASK_OFFSET
        sta cl_loc
        stz cl_loc+1
        stz cl_loc+2
        jsr cl_peek
        pha
        ldx cl_a0                   ; the bank's bit
        lda #1
:       dex
        bmi :+
        asl a
        bra :-
:       sta cl_t0
        ldy #CL_D_BPP1
        lda (cl_desc),y
        beq @three
        pla
        ora cl_t0
        bra @set
@three: lda cl_t0
        eor #$FF
        sta cl_t0
        pla
        and cl_t0
@set:   pha
        lda #<MIA_VIDEO_CHR_1BPP_MASK_OFFSET
        sta cl_to
        stz cl_to+1
        stz cl_to+2
        pla
        jsr cl_poke
        clc
@fail:  rts

; cl_to = MIA_VIDEO_CHR_OFFSET + cl_a0 * 6144
bank_address:
        lda #<6144
        sta cl_mul
        lda #>6144
        sta cl_mul+1
        lda cl_a0
        ldx #0
        jsr cl_mul16
        clc
        lda cl_prod
        adc #<MIA_VIDEO_CHR_OFFSET
        sta cl_to
        lda cl_prod+1
        adc #>MIA_VIDEO_CHR_OFFSET
        sta cl_to+1
        lda cl_prod+2
        adc #^MIA_VIDEO_CHR_OFFSET
        sta cl_to+2
        rts
