; Sprite files, item by item: a shape or an animation loaded on its own, the
; shapes an animation needs, and forgetting a shape.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; LoadShape file, shape (a0)[, location (a1-a3)]
cl_load_shape:
        jsr cl_set_desc
        lda cl_a0
        jsr shape_item
        jcs fail
        bra default
cl_load_shape_at:
        jsr cl_set_desc
        lda cl_a0
        jsr shape_item
        jcs fail
        bra at

; LoadAnimation file, anim (a0)[, location (a1-a3)]
cl_load_animation:
        jsr cl_set_desc
        jsr anim_item
        jcs fail
        bra default
cl_load_animation_at:
        jsr cl_set_desc
        jsr anim_item
        bcs fail
at:
.if CL_CHECKS
        ldx #cl_a1
        jsr cl_check_loc
        bcs fail
.endif
        bra load
; Without a location, an item goes where it would be if the whole file were
; in its slot, so items loaded one by one never overlap.
default:
        jsr cl_desc_default
        jsr offset
        ldx #cl_to
        jsr cl_add_loc
        ldx #2
:       lda cl_to,x
        sta cl_a1,x
        dex
        bpl :-
; cl_t3 = item number, cl_a1-a3 = where.
load:   jsr cl_load_idle
        lda cl_t3
        jsr cl_item                 ; cl_ptr = its offset and size
        ldx #2
:       stz cl_sd_fstride,x
        stz cl_sd_dstride,x
        lda cl_a1,x
        sta cl_sd_dest,x
        dex
        bpl :-
        ldy #0
        lda (cl_ptr),y
        sta cl_sd_off
        iny
        lda (cl_ptr),y
        sta cl_sd_off+1
        iny
        lda (cl_ptr),y
        sta cl_sd_off+2
        iny
        lda (cl_ptr),y
        sta cl_sd_rowlen
        iny
        lda (cl_ptr),y
        sta cl_sd_rowlen+1
        stz cl_sd_rowlen+2
        lda #1
        sta cl_sd_rows
        stz cl_sd_rows+1
        jsr cl_sd_part
        bcs fail
        lda cl_t3                   ; loaded: set its location
        jsr cl_item
        ldy #0
        lda cl_a1
        sta (cl_cpu),y
        iny
        lda cl_a2
        sta (cl_cpu),y
        iny
        lda cl_a3
        sta (cl_cpu),y
        clc
fail:   rts

; cl_prod = the file offset of item cl_t3.
offset: lda cl_t3
        jsr cl_item
        ldy #0
        lda (cl_ptr),y
        sta cl_prod
        iny
        lda (cl_ptr),y
        sta cl_prod+1
        iny
        lda (cl_ptr),y
        sta cl_prod+2
        rts

; A = shape number: cl_t3 = its item number. Carry set if there is no such shape.
shape_item:
        sta cl_t3
.if CL_CHECKS
        ldy #CL_D_SHAPES
        cmp (cl_desc),y
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        clc
        rts
; cl_a0 = animation number: cl_t3 = its item number, after the shapes.
anim_item:
.if CL_CHECKS
        lda cl_a0
        ldy #CL_D_ANIMS
        cmp (cl_desc),y
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        ldy #CL_D_SHAPES
        lda (cl_desc),y
        clc
        adc cl_a0
        sta cl_t3
        clc
        rts

; LoadAnimationShapes file, anim (a0): loads, each at its default place, the
; shapes the loaded animation uses that are not loaded.
cl_load_animation_shapes:
        jsr cl_set_desc
        jsr anim_item
        jcs @fail
        lda cl_t3
        jsr cl_item_loc
        bcc :+
        lda #CL_ERR_NOT_LOADED
        jmp cl_fail
:       ldx #2                      ; the animation, for each frame
:       lda cl_loc,x
        sta cl_a8,x
        dex
        bpl :-
        jsr cl_open_read
        jsr cl_read
        sta cl_a11                  ; frames left
        jsr cl_close_read
        stz cl_a4                   ; frame record offset: 1 + 7 x frame
        stz cl_a5
        stz cl_a6
@frame: lda cl_a11
        beq @done
        clc
        lda cl_a4
        adc #1
        sta cl_prod
        lda cl_a5
        adc #0
        sta cl_prod+1
        stz cl_prod+2
        ldx #2
:       lda cl_a8,x
        sta cl_loc,x
        dex
        bpl :-
        ldx #cl_loc
        jsr cl_add_loc
        jsr cl_open_read
        jsr cl_read                 ; the frame's shape
        sta cl_a0
        jsr cl_close_read
        lda cl_a0
        jsr cl_item_loc
        bcc @next                   ; loaded already
        lda cl_a0
        jsr shape_item
        bcs @fail
        jsr cl_desc_default
        jsr offset
        ldx #cl_to
        jsr cl_add_loc
        ldx #2
:       lda cl_to,x
        sta cl_a1,x
        dex
        bpl :-
        jsr load
        bcs @fail
@next:  clc
        lda cl_a4
        adc #7
        sta cl_a4
        bcc :+
        inc cl_a5
:       dec cl_a11
        bra @frame
@done:  clc
@fail:  rts

; ForgetShape file, shape (a0)
cl_forget_shape:
        jsr cl_set_desc
        lda cl_a0
        jsr shape_item
        bcs @fail
        lda cl_t3
        jsr cl_item
        lda #$FF
        ldy #2
:       sta (cl_cpu),y
        dey
        bpl :-
        clc
@fail:  rts
