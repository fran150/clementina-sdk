; A sprite file's items: its shapes, then its animations. Each has an entry
; in the descriptor's item table (file offset, 3 bytes; size, 2) and one in
; its location table (3 bytes).
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; Calls the routine at X (low) / Y (high) once per item of the sprite file
; rt_desc, with rt_ptr at the item's entry and rt_cpu at its location. The
; routine must leave rt_ptr, rt_cpu and rt_len alone.
rt_items_each:
        stx rt_len
        sty rt_len+1
        lda #0
        jsr rt_item
        ldy #RT_D_SHAPES
        lda (rt_desc),y
        clc
        ldy #RT_D_ANIMS
        adc (rt_desc),y
        sta rt_len+2
        beq @done
@item:  jsr @call
        clc
        lda rt_ptr
        adc #5
        sta rt_ptr
        bcc :+
        inc rt_ptr+1
:       clc
        lda rt_cpu
        adc #3
        sta rt_cpu
        bcc :+
        inc rt_cpu+1
:       dec rt_len+2
        bne @item
@done:  clc
        rts
@call:  jmp (rt_len)

; A = item number: rt_ptr = its entry, rt_cpu = its location's.
rt_item:
        pha
        sta rt_ptr                  ; 5 x number
        stz rt_ptr+1
        asl a
        rol rt_ptr+1
        asl a
        rol rt_ptr+1
        clc
        adc rt_ptr
        sta rt_ptr
        bcc :+
        inc rt_ptr+1
:       ldy #RT_D_ITEMS
        clc
        lda rt_ptr
        adc (rt_desc),y
        sta rt_ptr
        iny
        lda rt_ptr+1
        adc (rt_desc),y
        sta rt_ptr+1
        pla                         ; 3 x number
        sta rt_cpu
        stz rt_cpu+1
        asl a
        rol rt_cpu+1
        clc
        adc rt_cpu
        sta rt_cpu
        bcc :+
        inc rt_cpu+1
:       ldy #RT_D_LOCS
        clc
        lda rt_cpu
        adc (rt_desc),y
        sta rt_cpu
        iny
        lda rt_cpu+1
        adc (rt_desc),y
        sta rt_cpu+1
        rts

; A = item number: rt_loc = its location, carry set when it is not loaded.
; Leaves rt_ptr and rt_cpu at its entries.
rt_item_loc:
        jsr rt_item
        ldy #0
        lda (rt_cpu),y
        sta rt_loc
        iny
        lda (rt_cpu),y
        sta rt_loc+1
        iny
        lda (rt_cpu),y
        sta rt_loc+2
        cmp #$FF
        beq @none
        clc
        rts
@none:  sec
        rts
