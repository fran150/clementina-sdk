; Sprite files, item by item: a shape or an animation loaded on its own, the
; shapes an animation needs, and forgetting a shape.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; LoadShape file, shape (a0)[, location (a1-a3)]
rt_load_shape:
        jsr rt_set_desc
        lda rt_a0
        jsr shape_item
        jcs fail
        bra default
rt_load_shape_at:
        jsr rt_set_desc
        lda rt_a0
        jsr shape_item
        jcs fail
        bra at

; LoadAnimation file, anim (a0)[, location (a1-a3)]
rt_load_animation:
        jsr rt_set_desc
        jsr anim_item
        jcs fail
        bra default
rt_load_animation_at:
        jsr rt_set_desc
        jsr anim_item
        bcs fail
at:
.if RT_CHECKS
        ldx #rt_a1
        jsr rt_check_loc
        bcs fail
.endif
        bra load
; Without a location, an item goes where it would be if the whole file were
; in its slot, so items loaded one by one never overlap.
default:
        jsr rt_desc_default
        jsr offset
        ldx #rt_to
        jsr rt_add_loc
        ldx #2
:       lda rt_to,x
        sta rt_a1,x
        dex
        bpl :-
; rt_t3 = item number, rt_a1-a3 = where.
load:   jsr rt_load_idle
        lda rt_t3
        jsr rt_item                 ; rt_ptr = its offset and size
        ldx #2
:       stz rt_sd_fstride,x
        stz rt_sd_dstride,x
        lda rt_a1,x
        sta rt_sd_dest,x
        dex
        bpl :-
        ldy #0
        lda (rt_ptr),y
        sta rt_sd_off
        iny
        lda (rt_ptr),y
        sta rt_sd_off+1
        iny
        lda (rt_ptr),y
        sta rt_sd_off+2
        iny
        lda (rt_ptr),y
        sta rt_sd_rowlen
        iny
        lda (rt_ptr),y
        sta rt_sd_rowlen+1
        stz rt_sd_rowlen+2
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
        jsr rt_sd_part
        bcs fail
        lda rt_t3                   ; loaded: set its location
        jsr rt_item
        ldy #0
        lda rt_a1
        sta (rt_cpu),y
        iny
        lda rt_a2
        sta (rt_cpu),y
        iny
        lda rt_a3
        sta (rt_cpu),y
        clc
fail:   rts

; rt_prod = the file offset of item rt_t3.
offset: lda rt_t3
        jsr rt_item
        ldy #0
        lda (rt_ptr),y
        sta rt_prod
        iny
        lda (rt_ptr),y
        sta rt_prod+1
        iny
        lda (rt_ptr),y
        sta rt_prod+2
        rts

; A = shape number: rt_t3 = its item number. Carry set if there is no such shape.
shape_item:
        sta rt_t3
.if RT_CHECKS
        ldy #RT_D_SHAPES
        cmp (rt_desc),y
        bcc :+
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        clc
        rts
; rt_a0 = animation number: rt_t3 = its item number, after the shapes.
anim_item:
.if RT_CHECKS
        lda rt_a0
        ldy #RT_D_ANIMS
        cmp (rt_desc),y
        bcc :+
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        ldy #RT_D_SHAPES
        lda (rt_desc),y
        clc
        adc rt_a0
        sta rt_t3
        clc
        rts

; LoadAnimationShapes file, anim (a0): loads, each at its default place, the
; shapes the loaded animation uses that are not loaded.
rt_load_animation_shapes:
        jsr rt_set_desc
        jsr anim_item
        jcs @fail
        lda rt_t3
        jsr rt_item_loc
        bcc :+
        lda #RT_ERR_NOT_LOADED
        jmp rt_fail
:       ldx #2                      ; the animation, for each frame
:       lda rt_loc,x
        sta rt_a8,x
        dex
        bpl :-
        jsr rt_open_read
        jsr rt_read
        sta rt_a11                  ; frames left
        jsr rt_close_read
        stz rt_a4                   ; frame record offset: 1 + 7 x frame
        stz rt_a5
        stz rt_a6
@frame: lda rt_a11
        beq @done
        clc
        lda rt_a4
        adc #1
        sta rt_prod
        lda rt_a5
        adc #0
        sta rt_prod+1
        stz rt_prod+2
        ldx #2
:       lda rt_a8,x
        sta rt_loc,x
        dex
        bpl :-
        ldx #rt_loc
        jsr rt_add_loc
        jsr rt_open_read
        jsr rt_read                 ; the frame's shape
        sta rt_a0
        jsr rt_close_read
        lda rt_a0
        jsr rt_item_loc
        bcc @next                   ; loaded already
        lda rt_a0
        jsr shape_item
        bcs @fail
        jsr rt_desc_default
        jsr offset
        ldx #rt_to
        jsr rt_add_loc
        ldx #2
:       lda rt_to,x
        sta rt_a1,x
        dex
        bpl :-
        jsr load
        bcs @fail
@next:  clc
        lda rt_a4
        adc #7
        sta rt_a4
        bcc :+
        inc rt_a5
:       dec rt_a11
        bra @frame
@done:  clc
@fail:  rts

; ForgetShape file, shape (a0)
rt_forget_shape:
        jsr rt_set_desc
        lda rt_a0
        jsr shape_item
        bcs @fail
        lda rt_t3
        jsr rt_item
        lda #$FF
        ldy #2
:       sta (rt_cpu),y
        dey
        bpl :-
        clc
@fail:  rts
