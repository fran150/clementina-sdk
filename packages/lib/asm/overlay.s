; Overlays: 1,000 tiles, then 1,000 attributes, the overlay tables' layout.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; ShowOverlay overlay: copies it into the overlay tables, unless it is loaded there.
cl_show_overlay:
        jsr cl_set_desc
        jsr cl_desc_loc
        bcs @fail
        lda #<MIA_VIDEO_OVERLAY_NT_OFFSET
        sta cl_to
        lda #>MIA_VIDEO_OVERLAY_NT_OFFSET
        sta cl_to+1
        lda #^MIA_VIDEO_OVERLAY_NT_OFFSET
        sta cl_to+2
        jsr cl_loc_equals_to
        beq @done
        lda #<2000
        sta cl_len
        lda #>2000
        sta cl_len+1
        stz cl_len+2
        jmp cl_copy
@done:  clc
@fail:  rts

; FillPlaceholder overlay, placeholder (cl_a0), tiles (cl_a1/cl_a2): writes
; width x height tile numbers, row by row, into the overlay's tile table.
cl_fill_placeholder:
        jsr cl_set_desc
.if CL_CHECKS
        lda cl_a0
        ldy #CL_D_HOLES
        cmp (cl_desc),y
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        ldy #CL_D_HOLE_TABLE        ; cl_ptr = the placeholder's column, row, width, height
        lda (cl_desc),y
        sta cl_ptr
        iny
        lda (cl_desc),y
        sta cl_ptr+1
        stz cl_prod+1
        lda cl_a0
        asl a
        rol cl_prod+1
        asl a
        rol cl_prod+1
        clc
        adc cl_ptr
        sta cl_ptr
        lda cl_ptr+1
        adc cl_prod+1
        sta cl_ptr+1
        ldy #1                      ; cl_to = MIA_VIDEO_OVERLAY_NT_OFFSET + row * 40 + column
        lda (cl_ptr),y
        sta cl_mul
        stz cl_mul+1
        lda #40
        ldx #0
        jsr cl_mul16
        ldy #0
        clc
        lda (cl_ptr),y
        adc cl_prod
        sta cl_prod
        bcc :+
        inc cl_prod+1
:       clc
        lda cl_prod
        adc #<MIA_VIDEO_OVERLAY_NT_OFFSET
        sta cl_to
        lda cl_prod+1
        adc #>MIA_VIDEO_OVERLAY_NT_OFFSET
        sta cl_to+1
        lda #^MIA_VIDEO_OVERLAY_NT_OFFSET
        adc #0
        sta cl_to+2
        lda cl_a1                   ; the tiles
        sta cl_cpu
        lda cl_a2
        sta cl_cpu+1
        ldy #3
        lda (cl_ptr),y
        sta cl_t1                   ; rows left
@row:   ldx #cl_to
        lda #(1 << IDX_FLAG_W_STP_ENA)
        jsr cl_seek_b
        ldy #2
        lda (cl_ptr),y
        tax                         ; columns left
        ldy #0
:       lda (cl_cpu),y
        sta IDXB_PORT
        iny
        dex
        bne :-
        tya                         ; the tiles move on a row
        clc
        adc cl_cpu
        sta cl_cpu
        bcc :+
        inc cl_cpu+1
:       clc                         ; and the table 40 cells
        lda cl_to
        adc #40
        sta cl_to
        bcc :+
        inc cl_to+1
:       dec cl_t1
        bne @row
        clc
        rts
