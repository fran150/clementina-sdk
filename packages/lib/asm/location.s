; Asset descriptor locations and arithmetic shared by library modules.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; Stores the asset descriptor from A/X in zero page.
cl_set_desc:
        sta cl_desc
        stx cl_desc+1
        rts

; ---------------------------------------------------------------------------
; Descriptors. cl_desc_loc copies the asset's location to cl_loc, failing
; with CL_ERR_NOT_LOADED when it has none; cl_desc_default copies its default
; location to cl_to; cl_set_desc_loc makes cl_to its location.
; ---------------------------------------------------------------------------
cl_desc_loc:
        ldy #CL_D_LOC
        lda (cl_desc),y
        sta cl_loc
        iny
        lda (cl_desc),y
        sta cl_loc+1
        iny
        lda (cl_desc),y
        sta cl_loc+2
        cmp #$FF
        beq @none
        clc
        rts
@none:  lda #CL_ERR_NOT_LOADED
        jmp cl_fail

cl_desc_default:
        ldy #CL_D_DEFAULT
        lda (cl_desc),y
        sta cl_to
        iny
        lda (cl_desc),y
        sta cl_to+1
        iny
        lda (cl_desc),y
        sta cl_to+2
        rts

cl_set_desc_loc:
        ldy #CL_D_LOC
        lda cl_to
        sta (cl_desc),y
        iny
        lda cl_to+1
        sta (cl_desc),y
        iny
        lda cl_to+2
        sta (cl_desc),y
        rts

; Compare the three-byte locations cl_loc and cl_to. Returns Z set when
; they match; changes A and X but leaves both locations untouched.
cl_loc_equals_to:
        ldx #2
@byte:  lda cl_loc,x
        cmp cl_to,x
        bne @different
        dex
        bpl @byte
        lda #0
        rts
@different:
        lda #1
        rts

; X = the zero-page address of a location. Carry set, with CL_ERR_LOCATION,
; unless it is a MIA address, or a bank (high byte $80-$9F) and an address
; in $8000-$BFFF.
cl_check_loc:
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
@bad:   lda #CL_ERR_LOCATION
        jmp cl_fail

; ---------------------------------------------------------------------------
; cl_mul16: cl_prod = cl_mul (16-bit) * A (low) / X (high), the low 24 bits.
; Uses cl_mul+2 and cl_t4.
; ---------------------------------------------------------------------------
cl_mul16:
        sta cl_t4
        stz cl_mul+2
        stz cl_prod
        stz cl_prod+1
        stz cl_prod+2
        ldy #16
@bit:   txa                     ; the multiplier's next bit, lowest first
        lsr a
        tax
        ror cl_t4
        bcc @skip
        clc                     ; adds the multiplicand, shifted so far
        lda cl_prod
        adc cl_mul
        sta cl_prod
        lda cl_prod+1
        adc cl_mul+1
        sta cl_prod+1
        lda cl_prod+2
        adc cl_mul+2
        sta cl_prod+2
@skip:  asl cl_mul
        rol cl_mul+1
        rol cl_mul+2
        dey
        bne @bit
        rts

; ---------------------------------------------------------------------------
; cl_add_loc: adds cl_prod (24-bit) to the location at zero-page address X.
; In a bank it counts on through the next banks, as if they were one run.
; Uses cl_t4.
; ---------------------------------------------------------------------------
cl_add_loc:
        lda 2,x
        bmi @bank
        clc
        lda 0,x
        adc cl_prod
        sta 0,x
        lda 1,x
        adc cl_prod+1
        sta 1,x
        lda 2,x
        adc cl_prod+2
        sta 2,x
        rts
@bank:  clc                     ; the offset inside the bank, plus cl_prod
        lda 0,x
        adc cl_prod
        sta 0,x
        lda 1,x
        and #$3F
        adc cl_prod+1
        pha                     ; bits 6-7 overflow into the bank
        lda #0
        adc cl_prod+2           ; each unit here is 4 more banks
        asl a
        asl a
        sta cl_t4
        pla
        pha
        rol a                   ; bits 7-6 down to 1-0
        rol a
        rol a
        and #$03
        ora cl_t4
        clc
        adc 2,x
        sta 2,x
        pla
        and #$3F
        ora #$80
        sta 1,x
        rts
