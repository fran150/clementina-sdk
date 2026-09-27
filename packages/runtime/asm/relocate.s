; Relocate and Forget: move a loaded asset, or mark it not loaded.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; Relocate asset, location (rt_a0-a2). A background moves its loaded window;
; a sprite file moves with its items that were loaded with it.
rt_relocate:
        jsr rt_set_desc
.if RT_CHECKS
        ldx #rt_a0
        jsr rt_check_loc
        bcs @fail
.endif
        jsr rt_desc_loc
        bcs @fail
        ldx #2                      ; the old place, for the items
:       lda rt_loc,x
        sta rt_a3,x
        lda rt_a0,x
        sta rt_to,x
        dex
        bpl :-
        ldy #RT_D_TYPE
        lda (rt_desc),y
        cmp #RT_BACKGROUND
        bne @whole
        ldy #RT_D_WIN_COLS          ; 2 x columns x rows
        lda (rt_desc),y
        sta rt_mul
        iny
        lda (rt_desc),y
        sta rt_mul+1
        iny
        lda (rt_desc),y
        pha
        iny
        lda (rt_desc),y
        tax
        pla
        jsr rt_mul16
        asl rt_prod
        rol rt_prod+1
        rol rt_prod+2
        ldx #2
:       lda rt_prod,x
        sta rt_len,x
        dex
        bpl :-
        bra @copy
@whole: ldy #RT_D_SIZE
        ldx #0
:       lda (rt_desc),y
        sta rt_len,x
        iny
        inx
        cpx #3
        bne :-
@copy:  jsr rt_copy
        ldx #2
:       lda rt_a0,x
        sta rt_to,x
        dex
        bpl :-
        jsr rt_set_desc_loc
        ldy #RT_D_TYPE
        lda (rt_desc),y
        cmp #RT_SPRITES
        bne @done
        ldx #<move_item             ; items at old + offset go to new + offset
        ldy #>move_item
        jmp rt_items_each
@done:  clc
@fail:  rts

; rt_items_each callback: rt_ptr = the item's offset and size, rt_cpu = its
; location entry.
move_item:
        ldx #2                      ; where it would be with the file at the old place
:       lda rt_a3,x
        sta rt_loc,x
        dex
        bpl :-
        jsr item_offset
        ldx #rt_loc
        jsr rt_add_loc
        ldy #2
:       lda (rt_cpu),y
        cmp rt_loc,y
        bne @keep
        dey
        bpl :-
        ldx #2
:       lda rt_a0,x
        sta rt_loc,x
        dex
        bpl :-
        jsr item_offset
        ldx #rt_loc
        jsr rt_add_loc
        ldy #2
:       lda rt_loc,y
        sta (rt_cpu),y
        dey
        bpl :-
@keep:  rts

item_offset:
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

; Forget asset: not loaded, nor are a sprite file's items or a map's window.
rt_forget:
        jsr rt_set_desc
        lda #$FF
        sta rt_to
        sta rt_to+1
        sta rt_to+2
        jsr rt_set_desc_loc
        ldy #RT_D_TYPE
        lda (rt_desc),y
        cmp #RT_BACKGROUND
        beq @map
        cmp #RT_SPRITES
        bne @done
        ldx #<forget_item
        ldy #>forget_item
        jmp rt_items_each
@map:   lda #0
        ldy #RT_D_WIN_COLS
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        iny
        sta (rt_desc),y
@done:  clc
        rts

forget_item:
        lda #$FF
        ldy #2
:       sta (rt_cpu),y
        dey
        bpl :-
        rts
