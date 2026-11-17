; The real-time part of Catch the Star. The BASIC program calls play with
; SYS 28672. It runs the game 60 frames a second: it moves the basket while
; an arrow is held and moves the stars down at the speed BASIC sets. It
; returns to BASIC when a star is caught or missed, or when it has used the
; new star BASIC gave it. It shares the bytes below with BASIC, which reads
; and writes them with PEEK and POKE.
.setcpu "65C02"
.include "clementina-lib.inc"   ; WaitTick, ReadPad and KeyHeld
.include "clementina.inc"       ; KERN_PLOT and KERN_CHROUT_GLYPH
.export play

STARS        = 8                ; how many stars can fall at once
TOP_ROW      = 2                ; a new star starts on this row
BASKET_ROW   = 22               ; the row the basket moves along
SLOW_TICKS   = 6                ; frames per basket step: 10 columns a second
FAST_TICKS   = 2                ; with Shift held: 30 columns a second
LEFT_SHIFT   = 225              ; the keyboard codes of the Shift keys
RIGHT_SHIFT  = 229
SPAWN_MOVES  = 6                ; star moves between new stars
STAR_COLOR   = 1                ; palette bank 1, the star palette: yellow
BASKET_COLOR = 2                ; palette bank 2, the basket palette: green
TEXT_ATTR    = $0302            ; the kernel's pen for new characters

BASKET     = $0280              ; 640: the basket's left column
CAUGHT     = $0281              ; 641: stars caught (play adds, BASIC clears)
MISSED     = $0282              ; 642: stars missed (play adds, BASIC clears)
SPAWN      = $0283              ; 643: column+1 of the next star, 0 for none
SPEED      = $0284              ; 644: frames between star moves (BASIC)
STAR_COL   = $0285              ; 645-652: each star's column
STAR_ROW   = $028D              ; 653-660: each star's row, 0 when unused

.data                           ; these start at 0 when the code loads
slot:        .byte 0            ; the star being moved
ticks:       .byte 0            ; frames since the last WaitTick
star_wait:   .byte 0            ; frames until the stars move
basket_wait: .byte 0            ; frames until the basket may move
spawn_wait:  .byte 0            ; star moves until a new star may start

.code

; SYS 28672: play until something happens.
play:
  jsr draw_basket
@frame:
  WaitTick                      ; wait for the next 60 Hz frame
  sta ticks                     ; A = frames since the last one

  lda basket_wait               ; the basket
  sec
  sbc ticks
  bcs :+
  lda #0
: sta basket_wait
  bne @stars
  ReadPad #0                    ; the keyboard's arrows, or gamepad 0
  bit #CL_PAD_LEFT
  beq @right
  lda BASKET
  beq @stars                    ; already at the left edge
  dec BASKET
  bra @moved
@right:
  bit #CL_PAD_RIGHT
  beq @stars
  lda BASKET
  cmp #37
  beq @stars                    ; already at the right edge
  inc BASKET
@moved:
  jsr draw_basket
  lda #SLOW_TICKS               ; wait before the next step
  sta basket_wait
  KeyHeld #LEFT_SHIFT           ; less with Shift held
  bne @fast
  KeyHeld #RIGHT_SHIFT
  beq @stars
@fast:
  lda #FAST_TICKS
  sta basket_wait

@stars:
  lda star_wait                 ; the stars
  sec
  sbc ticks
  bcc @move
  beq @move
  sta star_wait
  bra @frame
@move:
  lda SPEED
  sta star_wait
  jsr move_stars
  lda CAUGHT                    ; anything for BASIC?
  ora MISSED
  bne @done
  lda spawn_wait                ; time for a new star?
  beq :+
  dec spawn_wait
  bra @again
:
  lda SPAWN
  beq @again                    ; BASIC hasn't chosen a column yet
  jsr start_star
  lda #SPAWN_MOVES
  sta spawn_wait
@done:
  rts                           ; back to BASIC
@again:
  jmp @frame                    ; too far for a branch

; Move every star down one row, and count the ones that reach the basket
; row as caught or missed.
move_stars:
  ldx #STARS-1
@each:
  stx slot
  lda STAR_ROW,x
  beq @next                     ; this slot has no star
  lda #' '                      ; erase it where it was
  jsr draw_star
  ldx slot
  inc STAR_ROW,x
  lda STAR_ROW,x
  cmp #BASKET_ROW
  bne @show
  stz STAR_ROW,x                ; it reached the basket row: judge it
  lda STAR_COL,x
  sec
  sbc BASKET                    ; 0, 1 or 2 when it is over the basket
  cmp #3
  bcs @miss
  inc CAUGHT
  bra @next
@miss:
  inc MISSED
  bra @next
@show:
  lda #'*'                      ; draw it one row lower
  jsr draw_star
@next:
  ldx slot
  dex
  bpl @each
  rts

; Start the star SPAWN asks for in a free slot, and clear SPAWN.
start_star:
  ldx #STARS-1
@find:
  lda STAR_ROW,x
  beq @free
  dex
  bpl @find
  bra @clear                    ; every slot is in use: skip it
@free:
  stx slot
  lda SPAWN
  dec a
  sta STAR_COL,x
  lda #TOP_ROW
  sta STAR_ROW,x
  lda #'*'
  jsr draw_star
@clear:
  stz SPAWN
  rts

; Draw the character in A, in yellow, at the column and row of star `slot`.
draw_star:
  pha
  lda #STAR_COLOR
  sta TEXT_ATTR
  ldx slot
  ldy STAR_COL,x                ; KERN_PLOT: Y = column
  lda STAR_ROW,x
  tax                           ;            X = row
  clc                           ;            C = 0 moves the cursor
  jsr KERN_PLOT
  pla
  jmp KERN_CHROUT_GLYPH         ; draw A there

; Draw the basket in green at BASKET, with a space on each side to erase
; where it was before it moved one column.
draw_basket:
  ldx #0                        ; which character of " [_] "
@cell:
  txa
  clc
  adc BASKET
  dec a                         ; its column: BASKET - 1 + X
  cmp #40
  bcs @skip                     ; off the screen (-1 is 255)
  tay                           ; KERN_PLOT: Y = column
  phx
  ldx #BASKET_ROW               ;            X = row
  clc
  jsr KERN_PLOT
  lda #BASKET_COLOR
  sta TEXT_ATTR
  plx
  lda basket,x
  jsr KERN_CHROUT_GLYPH
@skip:
  inx
  cpx #5
  bne @cell
  rts

basket:
  .byte " [_] "
