; Tilesets: one CHR bank, 6,144 bytes.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; UseTileset tileset, chrBank (rt_a0): copies it into the bank unless it is
; loaded there, then sets the bank's bit in CHR_1BPP_MASK to the tileset's mode.
rt_use_tileset:
        jsr rt_set_desc
.if RT_CHECKS
        lda rt_a0
        cmp #8
        bcc :+
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        jsr rt_desc_loc
        bcs @fail
        jsr bank_address
        ldx #2                      ; there already?
:       lda rt_loc,x
        cmp rt_to,x
        bne @copy
        dex
        bpl :-
        bra @mode
@copy:  stz rt_len
        lda #>6144
        sta rt_len+1
        stz rt_len+2
        jsr rt_copy
@mode:  lda #<RC_1BPP_MASK
        sta rt_loc
        stz rt_loc+1
        stz rt_loc+2
        jsr rt_peek
        pha
        ldx rt_a0                   ; the bank's bit
        lda #1
:       dex
        bmi :+
        asl a
        bra :-
:       sta rt_t0
        ldy #RT_D_BPP1
        lda (rt_desc),y
        beq @three
        pla
        ora rt_t0
        bra @set
@three: lda rt_t0
        eor #$FF
        sta rt_t0
        pla
        and rt_t0
@set:   pha
        lda #<RC_1BPP_MASK
        sta rt_to
        stz rt_to+1
        stz rt_to+2
        pla
        jsr rt_poke
        clc
@fail:  rts

; rt_to = MIA_CHR + rt_a0 * 6144
bank_address:
        lda #<6144
        sta rt_mul
        lda #>6144
        sta rt_mul+1
        lda rt_a0
        ldx #0
        jsr rt_mul16
        clc
        lda rt_prod
        adc #<MIA_CHR
        sta rt_to
        lda rt_prod+1
        adc #>MIA_CHR
        sta rt_to+1
        lda rt_prod+2
        adc #^MIA_CHR
        sta rt_to+2
        rts
