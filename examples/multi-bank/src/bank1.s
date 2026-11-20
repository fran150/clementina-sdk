; Bank 1: the gate, and the frame both rooms draw around their name.
.setcpu "65C02"
.include "far.inc"
.export room1, frame

.segment "BANK1"
room1:  jsr frame               ; same bank: a plain JSR
        Print gate
        jsr frame
        rts

frame:  Print line
        rts

gate:   .byte "|   THE GATE   |", 13, 0
line:   .byte "+--------------+", 13, 0
