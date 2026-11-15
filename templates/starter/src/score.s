; Routines the BASIC program calls with SYS. Each returns with RTS and
; uses only zero page $98-$DF, so BASIC carries on afterwards.
.setcpu "65C02"
.export add_point

SCORE = $0280                   ; the BASIC program reads it with PEEK(640)

.segment "CODE"

; SYS 28672: add one point to SCORE.
add_point:
  inc SCORE
  rts
