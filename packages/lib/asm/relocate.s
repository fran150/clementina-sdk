; Relocate and Forget: move a loaded asset, or mark it not loaded.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; Relocate asset, location (cl_a0-a2). A background moves its loaded window;
; a sprite file moves with its items that were loaded with it.
cl_relocate:
        jsr cl_set_desc
.if CL_CHECKS
        ldx #cl_a0
        jsr cl_check_loc
        bcs @fail
.endif
        jsr cl_desc_loc
        bcs @fail
        ldx #2                      ; the old place, for the items
:       lda cl_loc,x
        sta cl_a3,x
        lda cl_a0,x
        sta cl_to,x
        dex
        bpl :-
        ldy #CL_D_TYPE
        lda (cl_desc),y
        cmp #CL_BACKGROUND
        bne @whole
        ldy #CL_D_WIN_COLS          ; 2 x columns x rows
        lda (cl_desc),y
        sta cl_mul
        iny
        lda (cl_desc),y
        sta cl_mul+1
        iny
        lda (cl_desc),y
        pha
        iny
        lda (cl_desc),y
        tax
        pla
        jsr cl_mul16
        asl cl_prod
        rol cl_prod+1
        rol cl_prod+2
        ldx #2
:       lda cl_prod,x
        sta cl_len,x
        dex
        bpl :-
        bra @copy
@whole: ldy #CL_D_SIZE
        ldx #0
:       lda (cl_desc),y
        sta cl_len,x
        iny
        inx
        cpx #3
        bne :-
@copy:  jsr cl_copy
        ldx #2
:       lda cl_a0,x
        sta cl_to,x
        dex
        bpl :-
        jsr cl_set_desc_loc
        ldy #CL_D_TYPE
        lda (cl_desc),y
        cmp #CL_SPRITES
        bne @done
        ldx #<move_item             ; items at old + offset go to new + offset
        ldy #>move_item
        jmp cl_items_each
@done:  clc
@fail:  rts

; cl_items_each callback: cl_ptr = the item's offset and size, cl_cpu = its
; location entry.
move_item:
        ldx #2                      ; where it would be with the file at the old place
:       lda cl_a3,x
        sta cl_loc,x
        dex
        bpl :-
        jsr item_offset
        ldx #cl_loc
        jsr cl_add_loc
        ldy #2
:       lda (cl_cpu),y
        cmp cl_loc,y
        bne @keep
        dey
        bpl :-
        ldx #2
:       lda cl_a0,x
        sta cl_loc,x
        dex
        bpl :-
        jsr item_offset
        ldx #cl_loc
        jsr cl_add_loc
        ldy #2
:       lda cl_loc,y
        sta (cl_cpu),y
        dey
        bpl :-
@keep:  rts

item_offset:
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

; Forget asset: not loaded, nor are a sprite file's items or a map's window.
cl_forget:
        jsr cl_set_desc
        lda #$FF
        sta cl_to
        sta cl_to+1
        sta cl_to+2
        jsr cl_set_desc_loc
        ldy #CL_D_TYPE
        lda (cl_desc),y
        cmp #CL_BACKGROUND
        beq @map
        cmp #CL_SPRITES
        bne @done
        ldx #<forget_item
        ldy #>forget_item
        jmp cl_items_each
@map:   lda #0
        ldy #CL_D_WIN_COLS
        sta (cl_desc),y
        iny
        sta (cl_desc),y
        iny
        sta (cl_desc),y
        iny
        sta (cl_desc),y
@done:  clc
        rts

forget_item:
        lda #$FF
        ldy #2
:       sta (cl_cpu),y
        dey
        bpl :-
        rts
