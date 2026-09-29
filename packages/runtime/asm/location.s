; Asset descriptor locations and arithmetic shared by runtime modules.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; Stores the asset descriptor from A/X in zero page.
rt_set_desc:
        sta rt_desc
        stx rt_desc+1
        rts

; ---------------------------------------------------------------------------
; Descriptors. rt_desc_loc copies the asset's location to rt_loc, failing
; with RT_ERR_NOT_LOADED when it has none; rt_desc_default copies its default
; location to rt_to; rt_set_desc_loc makes rt_to its location.
; ---------------------------------------------------------------------------
rt_desc_loc:
        ldy #RT_D_LOC
        lda (rt_desc),y
        sta rt_loc
        iny
        lda (rt_desc),y
        sta rt_loc+1
        iny
        lda (rt_desc),y
        sta rt_loc+2
        cmp #$FF
        beq @none
        clc
        rts
@none:  lda #RT_ERR_NOT_LOADED
        jmp rt_fail

rt_desc_default:
        ldy #RT_D_DEFAULT
        lda (rt_desc),y
        sta rt_to
        iny
        lda (rt_desc),y
        sta rt_to+1
        iny
        lda (rt_desc),y
        sta rt_to+2
        rts

rt_set_desc_loc:
        ldy #RT_D_LOC
        lda rt_to
        sta (rt_desc),y
        iny
        lda rt_to+1
        sta (rt_desc),y
        iny
        lda rt_to+2
        sta (rt_desc),y
        rts

; Compare the three-byte locations rt_loc and rt_to. Returns Z set when
; they match; changes A and X but leaves both locations untouched.
rt_loc_equals_to:
        ldx #2
@byte:  lda rt_loc,x
        cmp rt_to,x
        bne @different
        dex
        bpl @byte
        lda #0
        rts
@different:
        lda #1
        rts

; X = the zero-page address of a location. Carry set, with RT_ERR_LOCATION,
; unless it is a MIA address, or a bank (high byte $80-$9F) and an address
; in $8000-$BFFF.
rt_check_loc:
        lda 2,x
        bmi @bank
        cmp #$04
        bcs @bad
        clc
        rts
@bank:  cmp #$A0
        bcs @bad
        lda 1,x
        cmp #$80
        bcc @bad
        cmp #$C0
        bcs @bad
        clc
        rts
@bad:   lda #RT_ERR_LOCATION
        jmp rt_fail

; ---------------------------------------------------------------------------
; rt_mul16: rt_prod = rt_mul (16-bit) * A (low) / X (high), the low 24 bits.
; Uses rt_mul+2 and rt_t4.
; ---------------------------------------------------------------------------
rt_mul16:
        sta rt_t4
        stz rt_mul+2
        stz rt_prod
        stz rt_prod+1
        stz rt_prod+2
        ldy #16
@bit:   txa                     ; the multiplier's next bit, lowest first
        lsr a
        tax
        ror rt_t4
        bcc @skip
        clc                     ; adds the multiplicand, shifted so far
        lda rt_prod
        adc rt_mul
        sta rt_prod
        lda rt_prod+1
        adc rt_mul+1
        sta rt_prod+1
        lda rt_prod+2
        adc rt_mul+2
        sta rt_prod+2
@skip:  asl rt_mul
        rol rt_mul+1
        rol rt_mul+2
        dey
        bne @bit
        rts

; ---------------------------------------------------------------------------
; rt_add_loc: adds rt_prod (24-bit) to the location at zero-page address X.
; In a bank it counts on through the next banks, as if they were one run.
; Uses rt_t4.
; ---------------------------------------------------------------------------
rt_add_loc:
        lda 2,x
        bmi @bank
        clc
        lda 0,x
        adc rt_prod
        sta 0,x
        lda 1,x
        adc rt_prod+1
        sta 1,x
        lda 2,x
        adc rt_prod+2
        sta 2,x
        rts
@bank:  clc                     ; the offset inside the bank, plus rt_prod
        lda 0,x
        adc rt_prod
        sta 0,x
        lda 1,x
        and #$3F
        adc rt_prod+1
        pha                     ; bits 6-7 overflow into the bank
        lda #0
        adc rt_prod+2           ; each unit here is 4 more banks
        asl a
        asl a
        sta rt_t4
        pla
        pha
        rol a                   ; bits 7-6 down to 1-0
        rol a
        rol a
        and #$03
        ora rt_t4
        clc
        adc 2,x
        sta 2,x
        pla
        and #$3F
        ora #$80
        sta 1,x
        rts
