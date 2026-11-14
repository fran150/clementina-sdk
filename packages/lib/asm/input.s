; Held controls from MIA's input block: the keyboard's HID bitmap at
; $11000 (bit usage & 7 of byte usage >> 3) and four 10-byte gamepad
; records from $11050. Typed text is a separate FIFO; these routines
; leave it alone. Source: clementina-mia input/input.h.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "RODATA"
; The keyboard's share of ReadPad, ordered by bitmap byte: the byte, the
; key's bit in it, and the CL_PAD bit it sets. The table ends at byte KEY_BYTES.
KEY_BYTES = 11
key_byte:
        .byte $04 >> 3, $07 >> 3            ; A, D
        .byte $16 >> 3                      ; S
        .byte $1A >> 3, $1B >> 3, $1D >> 3  ; W, X, Z
        .byte $28 >> 3, $2B >> 3, $2C >> 3  ; Enter, Tab, Space
        .byte $4F >> 3                      ; Right arrow
        .byte $50 >> 3, $51 >> 3, $52 >> 3  ; Left, Down, Up arrows
        .byte KEY_BYTES
key_mask:
        .byte 1 << ($04 & 7), 1 << ($07 & 7)
        .byte 1 << ($16 & 7)
        .byte 1 << ($1A & 7), 1 << ($1B & 7), 1 << ($1D & 7)
        .byte 1 << ($28 & 7), 1 << ($2B & 7), 1 << ($2C & 7)
        .byte 1 << ($4F & 7)
        .byte 1 << ($50 & 7), 1 << ($51 & 7), 1 << ($52 & 7)
key_pad:
        .byte CL_PAD_LEFT, CL_PAD_RIGHT
        .byte CL_PAD_DOWN
        .byte CL_PAD_UP, CL_PAD_B, CL_PAD_A
        .byte CL_PAD_START, CL_PAD_SELECT, CL_PAD_A
        .byte CL_PAD_RIGHT
        .byte CL_PAD_LEFT, CL_PAD_DOWN, CL_PAD_UP
bit_mask:
        .byte $01, $02, $04, $08, $10, $20, $40, $80

.segment "CODE"

; ReadPad player (X): A = the CL_PAD bits held on that gamepad; for player
; 0, together with the keyboard. A disconnected gamepad reads as nothing.
cl_read_pad:
.if CL_CHECKS
        cpx #4
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        stx cl_t1
.assert GAMEPAD_SLOT_SIZE = 10, error, "cl_read_pad multiplies the player by 10"
        txa                         ; the record: MIA_INPUT_GAMEPAD_OFFSET + player * 10
        asl a
        sta cl_t0
        asl a
        asl a
        adc cl_t0
        adc #<MIA_INPUT_GAMEPAD_OFFSET
        sta cl_loc
        lda #>MIA_INPUT_GAMEPAD_OFFSET
        sta cl_loc+1
        lda #^MIA_INPUT_GAMEPAD_OFFSET
        sta cl_loc+2
        ldx #cl_loc
        lda #(1 << IDX_FLAG_R_STP_ENA)
        jsr cl_seek_a
        stz cl_t0                   ; the result
        lda IDXA_PORT               ; d-pad: up 1, down 2, left 4, right 8
        bpl @keys                   ; bit 7 clear: not connected
        ora IDXA_PORT               ; the left stick's digital directions
        and #$0F                    ; match the CL_PAD direction bits
        sta cl_t0
        lda IDXA_PORT               ; buttons 0-7: A, B, ...
        and #%00000011
        asl a
        asl a
        asl a
        asl a
        tsb cl_t0
        lda IDXA_PORT               ; buttons 8-15: ..., Select 10, Start 11
        and #%00001100
        asl a
        asl a
        asl a
        asl a
        tsb cl_t0
@keys:  lda cl_t1
        bne @done
        lda #<MIA_INPUT_KEYBOARD_BITMAP_OFFSET
        sta cl_loc
        lda #>MIA_INPUT_KEYBOARD_BITMAP_OFFSET
        sta cl_loc+1
        lda #^MIA_INPUT_KEYBOARD_BITMAP_OFFSET
        sta cl_loc+2
        ldx #cl_loc
        lda #(1 << IDX_FLAG_R_STP_ENA)
        jsr cl_seek_a
        ldx #0                      ; the bitmap byte
        ldy #0                      ; the table entry
@byte:  lda IDXA_PORT
        sta cl_t2
@entry: txa
        cmp key_byte,y
        bne @next
        lda cl_t2
        and key_mask,y
        beq :+
        lda key_pad,y
        tsb cl_t0
:       iny
        bra @entry
@next:  inx
        cpx #KEY_BYTES
        bne @byte
@done:  lda cl_t0
        clc
        rts

; KeyHeld usage (A): A = nonzero while that Keyboard/Keypad usage is held.
cl_key_held:
        pha
        lsr a
        lsr a
        lsr a
        clc
        adc #<MIA_INPUT_KEYBOARD_BITMAP_OFFSET
        sta cl_loc
        lda #>MIA_INPUT_KEYBOARD_BITMAP_OFFSET
        sta cl_loc+1
        lda #^MIA_INPUT_KEYBOARD_BITMAP_OFFSET
        sta cl_loc+2
        ldx #cl_loc
        lda #0
        jsr cl_seek_a
        pla
        and #7
        tax
        lda IDXA_PORT
        and bit_mask,x
        clc
        rts
