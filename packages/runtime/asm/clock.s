; Game timing from MIA's wall clock: TI counts 1/60 s whatever the PHI2
; speed. CLOCK_SNAPSHOT latches it at $1107C, 3 bytes, little-endian.
; Source: clementina-mia sys/timing.c.
.setcpu "65C02"
.include "rt_internal.inc"

CLOCK_TI = MIA_CLOCK_SNAPSHOT_OFFSET + 4    ; after the snapshot's milliseconds

.segment "BSS"
last:   .res 1                      ; TI's low byte when WaitTick last returned
started: .res 1                     ; nonzero once WaitTick has returned

.segment "CODE"

; WaitTick: waits until TI moves on from the tick the last WaitTick returned
; at; A = the ticks since then (1-255, modulo 256). The first call returns
; at once with A = 1.
rt_wait_tick:
@poll:  jsr rt_wait
        lda #MIA_CMD_CLOCK_SNAPSHOT
        sta CMD_TRIGGER
        lda #<CLOCK_TI
        sta rt_loc
        lda #>CLOCK_TI
        sta rt_loc+1
        lda #^CLOCK_TI
        sta rt_loc+2
        ldx #rt_loc
        lda #0
        jsr rt_seek_a               ; waits for the snapshot
        ldx IDXA_PORT
        lda started
        beq @first
        txa
        sec
        sbc last
        beq @poll
        stx last
        clc
        rts
@first: dec started
        stx last
        lda #1
        clc
        rts
