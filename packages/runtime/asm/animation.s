; Animation instances: an animation of a sprite file playing at a position
; from a sprite record on. The game allocates each instance (RT_ANIM_SIZE bytes)
; and ticks it; frames are 7 bytes after the animation's frame count: shape,
; ticks, dx, dy (16-bit) and flips.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; StartAnimation inst, file (a0/a1), anim (a2), sprite (a3), x (a4/a5), y (a6/a7)
rt_start_animation:
        sta rt_ptr
        stx rt_ptr+1
        ldy #RT_ANIM_FILE
        lda rt_a0
        sta (rt_ptr),y
        iny
        lda rt_a1
        sta (rt_ptr),y
        ldy #RT_ANIM_NUMBER
        lda rt_a2
        sta (rt_ptr),y
        ldy #RT_ANIM_SPRITE
        lda rt_a3
        sta (rt_ptr),y
        jsr set_position
        lda #0
        ldy #RT_ANIM_FRAME
        sta (rt_ptr),y
        ldy #RT_ANIM_DRAWN
        sta (rt_ptr),y
        ldy #RT_ANIM_FLAGS
        lda #$80
        sta (rt_ptr),y
        lda #1                      ; draw frame 0 and start its ticks
        jsr show
        bcs @fail
        lda #RT_TICK_FRAME
        clc
@fail:  rts

; TickAnimation inst: A = RT_TICK_FRAME when the frame changed, plus
; RT_TICK_WRAP when it went back to frame 0.
rt_tick_animation:
        sta rt_ptr
        stx rt_ptr+1
        ldy #RT_ANIM_FLAGS
        lda (rt_ptr),y
        bpl @idle
        ldy #RT_ANIM_TICKS
        lda (rt_ptr),y
        dec a
        sta (rt_ptr),y
        bne @idle
        jsr frames                  ; rt_t0 = frame count
        bcs @fail
        ldy #RT_ANIM_FRAME
        lda (rt_ptr),y
        inc a
        ldx #RT_TICK_FRAME          ; the result
        cmp rt_t0
        bcc :+
        ldx #RT_TICK_FRAME | RT_TICK_WRAP
        lda #0
:       sta (rt_ptr),y
        phx
        lda #1
        jsr show
        pla                         ; keeps show's carry
        rts
@idle:  lda #0
        clc
@fail:  rts

; MoveAnimation inst, x (a4/a5), y (a6/a7): redraws the frame there.
rt_move_animation:
        sta rt_ptr
        stx rt_ptr+1
        jsr set_position
        ldy #RT_ANIM_FLAGS
        lda (rt_ptr),y
        bpl @idle
        lda #0                      ; the same frame, keeping its ticks
        jmp show
@idle:  clc
        rts

; StopAnimation inst: hides its sprites and stops it.
rt_stop_animation:
        sta rt_ptr
        stx rt_ptr+1
        ldy #RT_ANIM_FLAGS
        lda #0
        sta (rt_ptr),y
        ldy #RT_ANIM_SPRITE
        lda (rt_ptr),y
        sta rt_a0
        ldy #RT_ANIM_DRAWN
        lda (rt_ptr),y
        beq @done
        sta rt_a1
        lda #0
        sta (rt_ptr),y
        jmp rt_hide_sprites
@done:  clc
        rts

set_position:
        ldy #RT_ANIM_X
        ldx #0
:       lda rt_a4,x
        sta (rt_ptr),y
        iny
        inx
        cpx #4
        bne :-
        rts

; rt_desc = the instance's sprite file; rt_loc = its animation, rt_t0 = its
; frame count. Carry set, RT_ERR_MISSING, if the animation isn't loaded.
frames: ldy #RT_ANIM_FILE
        lda (rt_ptr),y
        sta rt_desc
        iny
        lda (rt_ptr),y
        sta rt_desc+1
        lda rt_ptr                  ; rt_item uses rt_ptr
        pha
        lda rt_ptr+1
        pha
        ldy #RT_ANIM_NUMBER
        lda (rt_ptr),y
        ldy #RT_D_SHAPES
        clc
        adc (rt_desc),y
        jsr rt_item_loc
        pla
        sta rt_ptr+1
        pla
        sta rt_ptr
        bcc :+
        lda #RT_ERR_MISSING
        jmp rt_fail
:       jsr rt_open_read
        jsr rt_read
        sta rt_t0
        jmp rt_close_read           ; carry clear

; Draws the current frame, hiding sprites the previous one used beyond it.
; A nonzero: also start the frame's ticks.
show:   sta rt_t2
        jsr frames
        jcs @fail
        ldy #RT_ANIM_FRAME             ; the frame's record: 1 + 7 x frame in
        lda (rt_ptr),y
        sta rt_mul
        stz rt_mul+1
        lda #7
        ldx #0
        jsr rt_mul16
        inc rt_prod
        bne :+
        inc rt_prod+1
:       ldx #rt_loc
        jsr rt_add_loc
        jsr rt_open_read
        jsr rt_read
        sta rt_a0                   ; shape
        jsr rt_read
        ldx rt_t2
        beq :+
        ldy #RT_ANIM_TICKS
        sta (rt_ptr),y
:       ldx #0                      ; dx, dy, flips
:       jsr rt_read
        sta rt_a2,x
        inx
        cpx #5
        bne :-
        jsr rt_close_read
        ldy #RT_ANIM_X                 ; plus the position
        clc
        lda rt_a2
        adc (rt_ptr),y
        sta rt_a2
        iny
        lda rt_a3
        adc (rt_ptr),y
        sta rt_a3
        iny
        clc
        lda rt_a4
        adc (rt_ptr),y
        sta rt_a4
        iny
        lda rt_a5
        adc (rt_ptr),y
        sta rt_a5
        ldy #RT_ANIM_SPRITE
        lda (rt_ptr),y
        sta rt_a1
        lda rt_ptr                  ; DrawShape uses rt_ptr
        pha
        lda rt_ptr+1
        pha
        lda rt_desc
        ldx rt_desc+1
        jsr rt_draw_shape
        tax                         ; the next free record
        pla
        sta rt_ptr+1
        pla
        sta rt_ptr
        bcc :+
        lda rt_error                ; its shape isn't loaded: nothing drawn
        cmp #RT_ERR_NOT_LOADED
        bne @fail
        lda #RT_ERR_MISSING
        jmp rt_fail
:       txa                         ; sprites drawn = next - first
        sec
        sbc rt_a1
        sta rt_t0
        ldy #RT_ANIM_DRAWN
        lda (rt_ptr),y              ; fewer than last time: hide the rest
        sec
        sbc rt_t0
        bcc @same
        beq @same
        sta rt_a1
        stx rt_a0
        lda rt_t0
        sta (rt_ptr),y
        jmp rt_hide_sprites
@same:  lda rt_t0
        sta (rt_ptr),y
        clc
        rts
@fail:  sec
        rts
