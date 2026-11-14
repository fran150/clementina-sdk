; Animation instances: an animation of a sprite file playing at a position
; from a sprite record on. The game allocates each instance (CL_ANIM_SIZE bytes)
; and ticks it; frames are 7 bytes after the animation's frame count: shape,
; ticks, dx, dy (16-bit) and flips.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; StartAnimation inst, file (a0/a1), anim (a2), sprite (a3), x (a4/a5), y (a6/a7)
cl_start_animation:
        sta cl_ptr
        stx cl_ptr+1
        ldy #CL_ANIM_FILE
        lda cl_a0
        sta (cl_ptr),y
        iny
        lda cl_a1
        sta (cl_ptr),y
        ldy #CL_ANIM_NUMBER
        lda cl_a2
        sta (cl_ptr),y
        ldy #CL_ANIM_SPRITE
        lda cl_a3
        sta (cl_ptr),y
        jsr set_position
        lda #0
        ldy #CL_ANIM_FRAME
        sta (cl_ptr),y
        ldy #CL_ANIM_DRAWN
        sta (cl_ptr),y
        ldy #CL_ANIM_FLAGS
        lda #$80
        sta (cl_ptr),y
        lda #1                      ; draw frame 0 and start its ticks
        jsr show
        bcs @fail
        lda #CL_TICK_FRAME
        clc
@fail:  rts

; TickAnimation inst: A = CL_TICK_FRAME when the frame changed, plus
; CL_TICK_WRAP when it went back to frame 0.
cl_tick_animation:
        sta cl_ptr
        stx cl_ptr+1
        ldy #CL_ANIM_FLAGS
        lda (cl_ptr),y
        bpl @idle
        ldy #CL_ANIM_TICKS
        lda (cl_ptr),y
        dec a
        sta (cl_ptr),y
        bne @idle
        jsr frames                  ; cl_t0 = frame count
        bcs @fail
        ldy #CL_ANIM_FRAME
        lda (cl_ptr),y
        inc a
        ldx #CL_TICK_FRAME          ; the result
        cmp cl_t0
        bcc :+
        ldx #CL_TICK_FRAME | CL_TICK_WRAP
        lda #0
:       sta (cl_ptr),y
        phx
        lda #1
        jsr show
        pla                         ; keeps show's carry
        rts
@idle:  lda #0
        clc
@fail:  rts

; MoveAnimation inst, x (a4/a5), y (a6/a7): redraws the frame there.
cl_move_animation:
        sta cl_ptr
        stx cl_ptr+1
        jsr set_position
        ldy #CL_ANIM_FLAGS
        lda (cl_ptr),y
        bpl @idle
        lda #0                      ; the same frame, keeping its ticks
        jmp show
@idle:  clc
        rts

; StopAnimation inst: hides its sprites and stops it.
cl_stop_animation:
        sta cl_ptr
        stx cl_ptr+1
        ldy #CL_ANIM_FLAGS
        lda #0
        sta (cl_ptr),y
        ldy #CL_ANIM_SPRITE
        lda (cl_ptr),y
        sta cl_a0
        ldy #CL_ANIM_DRAWN
        lda (cl_ptr),y
        beq @done
        sta cl_a1
        lda #0
        sta (cl_ptr),y
        jmp cl_hide_sprites
@done:  clc
        rts

set_position:
        ldy #CL_ANIM_X
        ldx #0
:       lda cl_a4,x
        sta (cl_ptr),y
        iny
        inx
        cpx #4
        bne :-
        rts

; cl_desc = the instance's sprite file; cl_loc = its animation, cl_t0 = its
; frame count. Carry set, CL_ERR_MISSING, if the animation isn't loaded.
frames: ldy #CL_ANIM_FILE
        lda (cl_ptr),y
        sta cl_desc
        iny
        lda (cl_ptr),y
        sta cl_desc+1
        lda cl_ptr                  ; cl_item uses cl_ptr
        pha
        lda cl_ptr+1
        pha
        ldy #CL_ANIM_NUMBER
        lda (cl_ptr),y
        ldy #CL_D_SHAPES
        clc
        adc (cl_desc),y
        jsr cl_item_loc
        pla
        sta cl_ptr+1
        pla
        sta cl_ptr
        bcc :+
        lda #CL_ERR_MISSING
        jmp cl_fail
:       jsr cl_open_read
        jsr cl_read
        sta cl_t0
        jmp cl_close_read           ; carry clear

; Draws the current frame, hiding sprites the previous one used beyond it.
; A nonzero: also start the frame's ticks.
show:   sta cl_t2
        jsr frames
        jcs @fail
        ldy #CL_ANIM_FRAME             ; the frame's record: 1 + 7 x frame in
        lda (cl_ptr),y
        sta cl_mul
        stz cl_mul+1
        lda #7
        ldx #0
        jsr cl_mul16
        inc cl_prod
        bne :+
        inc cl_prod+1
:       ldx #cl_loc
        jsr cl_add_loc
        jsr cl_open_read
        jsr cl_read
        sta cl_a0                   ; shape
        jsr cl_read
        ldx cl_t2
        beq :+
        ldy #CL_ANIM_TICKS
        sta (cl_ptr),y
:       ldx #0                      ; dx, dy, flips
:       jsr cl_read
        sta cl_a2,x
        inx
        cpx #5
        bne :-
        jsr cl_close_read
        ldy #CL_ANIM_X                 ; plus the position
        clc
        lda cl_a2
        adc (cl_ptr),y
        sta cl_a2
        iny
        lda cl_a3
        adc (cl_ptr),y
        sta cl_a3
        iny
        clc
        lda cl_a4
        adc (cl_ptr),y
        sta cl_a4
        iny
        lda cl_a5
        adc (cl_ptr),y
        sta cl_a5
        ldy #CL_ANIM_SPRITE
        lda (cl_ptr),y
        sta cl_a1
        lda cl_ptr                  ; DrawShape uses cl_ptr
        pha
        lda cl_ptr+1
        pha
        lda cl_desc
        ldx cl_desc+1
        jsr cl_draw_shape
        tax                         ; the next free record
        pla
        sta cl_ptr+1
        pla
        sta cl_ptr
        bcc :+
        lda cl_error                ; its shape isn't loaded: nothing drawn
        cmp #CL_ERR_NOT_LOADED
        bne @fail
        lda #CL_ERR_MISSING
        jmp cl_fail
:       txa                         ; sprites drawn = next - first
        sec
        sbc cl_a1
        sta cl_t0
        ldy #CL_ANIM_DRAWN
        lda (cl_ptr),y              ; fewer than last time: hide the rest
        sec
        sbc cl_t0
        bcc @same
        beq @same
        sta cl_a1
        stx cl_a0
        lda cl_t0
        sta (cl_ptr),y
        jmp cl_hide_sprites
@same:  lda cl_t0
        sta (cl_ptr),y
        clc
        rts
@fail:  sec
        rts
