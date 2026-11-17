; A routine the BASIC program calls with SYS 28672. It prints a line
; through the kernel and returns to BASIC with RTS.
.setcpu "65C02"
.include "clementina.inc"       ; names the kernel's routines, like KERN_CHROUT
.export hello

.code

hello:
  ldx #0
@next:
  lda message,x                 ; the next character, or 0 at the end
  beq @done
  jsr KERN_CHROUT               ; print it
  inx
  bra @next
@done:
  rts                           ; back to BASIC

message:
  .byte "HELLO FROM ASSEMBLY", 13, 0
