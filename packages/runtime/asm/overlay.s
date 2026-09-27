; Overlays: 1,000 tiles, then 1,000 attributes, the overlay tables' layout.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; ShowOverlay overlay: copies it into the overlay tables, unless it is loaded there.
rt_show_overlay:
        jsr rt_set_desc
        jsr rt_desc_loc
        bcs @fail
        lda rt_loc+2
        cmp #^MIA_OVERLAY
        bne @copy
        lda rt_loc+1
        cmp #>MIA_OVERLAY
        bne @copy
        lda rt_loc
        cmp #<MIA_OVERLAY
        beq @done
@copy:  lda #<MIA_OVERLAY
        sta rt_to
        lda #>MIA_OVERLAY
        sta rt_to+1
        lda #^MIA_OVERLAY
        sta rt_to+2
        lda #<2000
        sta rt_len
        lda #>2000
        sta rt_len+1
        stz rt_len+2
        jmp rt_copy
@done:  clc
@fail:  rts

; FillPlaceholder overlay, placeholder (rt_a0), tiles (rt_a1/rt_a2): writes
; width x height tile numbers, row by row, into the overlay's tile table.
rt_fill_placeholder:
        jsr rt_set_desc
.if RT_CHECKS
        lda rt_a0
        ldy #RT_D_HOLES
        cmp (rt_desc),y
        bcc :+
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        ldy #RT_D_HOLE_TABLE        ; rt_ptr = the placeholder's column, row, width, height
        lda (rt_desc),y
        sta rt_ptr
        iny
        lda (rt_desc),y
        sta rt_ptr+1
        stz rt_prod+1
        lda rt_a0
        asl a
        rol rt_prod+1
        asl a
        rol rt_prod+1
        clc
        adc rt_ptr
        sta rt_ptr
        lda rt_ptr+1
        adc rt_prod+1
        sta rt_ptr+1
        ldy #1                      ; rt_to = MIA_OVERLAY + row * 40 + column
        lda (rt_ptr),y
        sta rt_mul
        stz rt_mul+1
        lda #40
        ldx #0
        jsr rt_mul16
        ldy #0
        clc
        lda (rt_ptr),y
        adc rt_prod
        sta rt_prod
        bcc :+
        inc rt_prod+1
:       clc
        lda rt_prod
        adc #<MIA_OVERLAY
        sta rt_to
        lda rt_prod+1
        adc #>MIA_OVERLAY
        sta rt_to+1
        lda #^MIA_OVERLAY
        adc #0
        sta rt_to+2
        lda rt_a1                   ; the tiles
        sta rt_cpu
        lda rt_a2
        sta rt_cpu+1
        ldy #3
        lda (rt_ptr),y
        sta rt_t1                   ; rows left
@row:   ldx #rt_to
        lda #IXF_WRITE
        jsr rt_seek_b
        ldy #2
        lda (rt_ptr),y
        tax                         ; columns left
        ldy #0
:       lda (rt_cpu),y
        sta IDXB_PORT
        iny
        dex
        bne :-
        tya                         ; the tiles move on a row
        clc
        adc rt_cpu
        sta rt_cpu
        bcc :+
        inc rt_cpu+1
:       clc                         ; and the table 40 cells
        lda rt_to
        adc #40
        sta rt_to
        bcc :+
        inc rt_to+1
:       dec rt_t1
        bne @row
        clc
        rts
