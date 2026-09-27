; A minimal assembly game: store one observable value, then own the machine.
.setcpu "65C02"
.export game_start
.segment "CODE"
game_start:
  lda #42
  sta $0200
loop:
  jmp loop
