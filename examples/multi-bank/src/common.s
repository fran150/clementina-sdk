; The shared code, at $7000 below the banked window, so it is there whichever
; bank is mapped. BASIC calls show_room with SYS $7000 after it POKEs the
; room number (1 or 2) into $0280.
.setcpu "65C02"
.include "clementina.inc"       ; VIA_ORA and KERN_CHROUT
.include "far.inc"
.export show_room
.import room1, room2

ROOM = $0280                    ; the room BASIC asks for

.segment "ZEROPAGE"
far_ptr:  .res 2                ; the routine far_call calls
text_ptr: .res 2                ; the text print prints

.segment "DATA"
current_bank: .byte 0           ; the bank mapped now; BASIC runs with bank 0

.segment "CODE"
show_room:
        lda ROOM
        cmp #2
        beq @two
        FarCall room1
        rts
@two:   FarCall room2
        rts

; far_call: map bank A, call (far_ptr), then map the caller's bank again.
far_call:
        ldx current_bank        ; remember the caller's bank
        phx
        sta current_bank
        sta VIA_ORA             ; PA0-PA4 pick the bank at $8000-$BFFF
        jsr @call
        pla
        sta current_bank
        sta VIA_ORA
        rts
@call:  jmp (far_ptr)

; print: print the zero-terminated string at (text_ptr).
print:
        ldy #0
@next:  lda (text_ptr),y
        beq @done
        jsr KERN_CHROUT
        iny
        bne @next
@done:  rts
