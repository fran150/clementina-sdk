; A sprite file's items: its shapes, then its animations. Each has an entry
; in the descriptor's item table (file offset, 3 bytes; size, 2) and one in
; its location table (3 bytes).
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; Calls the routine at X (low) / Y (high) once per item of the sprite file
; cl_desc, with cl_ptr at the item's entry and cl_cpu at its location. The
; routine must leave cl_ptr, cl_cpu and cl_len alone.
cl_items_each:
        stx cl_len
        sty cl_len+1
        lda #0
        jsr cl_item
        ldy #CL_D_SHAPES
        lda (cl_desc),y
        clc
        ldy #CL_D_ANIMS
        adc (cl_desc),y
        sta cl_len+2
        beq @done
@item:  jsr @call
        clc
        lda cl_ptr
        adc #5
        sta cl_ptr
        bcc :+
        inc cl_ptr+1
:       clc
        lda cl_cpu
        adc #3
        sta cl_cpu
        bcc :+
        inc cl_cpu+1
:       dec cl_len+2
        bne @item
@done:  clc
        rts
@call:  jmp (cl_len)

; A = item number: cl_ptr = its entry, cl_cpu = its location's.
cl_item:
        pha
        sta cl_ptr                  ; 5 x number
        stz cl_ptr+1
        asl a
        rol cl_ptr+1
        asl a
        rol cl_ptr+1
        clc
        adc cl_ptr
        sta cl_ptr
        bcc :+
        inc cl_ptr+1
:       ldy #CL_D_ITEMS
        clc
        lda cl_ptr
        adc (cl_desc),y
        sta cl_ptr
        iny
        lda cl_ptr+1
        adc (cl_desc),y
        sta cl_ptr+1
        pla                         ; 3 x number
        sta cl_cpu
        stz cl_cpu+1
        asl a
        rol cl_cpu+1
        clc
        adc cl_cpu
        sta cl_cpu
        bcc :+
        inc cl_cpu+1
:       ldy #CL_D_LOCS
        clc
        lda cl_cpu
        adc (cl_desc),y
        sta cl_cpu
        iny
        lda cl_cpu+1
        adc (cl_desc),y
        sta cl_cpu+1
        rts

; A = item number: cl_loc = its location, carry set when it is not loaded.
; Leaves cl_ptr and cl_cpu at its entries.
cl_item_loc:
        jsr cl_item
        ldy #0
        lda (cl_cpu),y
        sta cl_loc
        iny
        lda (cl_cpu),y
        sta cl_loc+1
        iny
        lda (cl_cpu),y
        sta cl_loc+2
        cmp #$FF
        beq @none
        clc
        rts
@none:  sec
        rts
