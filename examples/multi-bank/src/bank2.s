; Bank 2: the cave. Its frame is in bank 1, so it calls it with FarCall.
.setcpu "65C02"
.include "far.inc"
.export room2
.import frame

.segment "BANK2"
room2:  FarCall frame           ; bank 1, then back to bank 2
        Print cave
        FarCall frame
        rts

cave:   .byte "|   THE CAVE   |", 13, 0
