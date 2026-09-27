; Backgrounds: drawing into the nametables, and reading or changing cells.
; What is loaded of a map is its window: WIN_COLS x WIN_ROWS cells from
; (WIN_COL, WIN_ROW), tiles row by row, then the attributes the same way.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; DrawScreen bg, col, row, table: 40 x 25 cells, or what the map has.
rt_draw_screen:
        jsr rt_set_desc
        sec                         ; columns left in the map from col
        ldy #RT_D_WIDTH
        lda (rt_desc),y
        sbc rt_a0
        sta rt_t0
        iny
        lda (rt_desc),y
        sbc rt_a1
        bcc @range
        bne @wide
        lda rt_t0
        beq @range
        cmp #40
        bcc :+
@wide:  lda #40
:       sta rt_a4
        sec                         ; rows left from row
        ldy #RT_D_HEIGHT
        lda (rt_desc),y
        sbc rt_a2
        sta rt_t0
        iny
        lda (rt_desc),y
        sbc rt_a3
        bcc @range
        bne @tall
        lda rt_t0
        beq @range
        cmp #25
        bcc :+
@tall:  lda #25
:       sta rt_a5
        stz rt_a7
        stz rt_a8
        bra draw
@range: lda #RT_ERR_RANGE
        jmp rt_fail

; DrawColumn and DrawRow: a rectangle one cell wide or high.
rt_draw_column:
        jsr rt_set_desc
        lda #1
        sta rt_a4
        bra draw
rt_draw_row:
        jsr rt_set_desc
        lda #1
        sta rt_a5
        bra draw

; DrawRect bg, col (a0/a1), row (a2/a3), width (a4), height (a5), table (a6),
; tcol (a7), trow (a8).
rt_draw_rect:
        jsr rt_set_desc
draw:
.if RT_CHECKS
        lda rt_a4
        beq @arg
        lda rt_a5
        beq @arg
        lda rt_a6
        cmp #8
        bcs @arg
        clc
        lda rt_a7
        adc rt_a4
        cmp #41
        bcs @arg
        clc
        lda rt_a8
        adc rt_a5
        cmp #26
        bcs @arg
.endif
        jsr map_at
        bcs @fail
        jsr table_at
        ldx #2                      ; tiles, keeping both ends for the attributes
:       lda rt_loc,x
        pha
        lda rt_to,x
        pha
        dex
        bpl :-
        jsr copy_rect
        ldx #0
:       pla
        sta rt_to,x
        pla
        sta rt_loc,x
        inx
        cpx #3
        bne :-
        jsr half                    ; attributes: after the window's tiles...
        ldx #rt_loc
        jsr rt_add_loc
        clc                         ; ...and in the attribute table
        lda rt_to
        adc #<(MIA_BG_ATTR - MIA_BG_NT)
        sta rt_to
        lda rt_to+1
        adc #>(MIA_BG_ATTR - MIA_BG_NT)
        sta rt_to+1
        lda rt_to+2
        adc #^(MIA_BG_ATTR - MIA_BG_NT)
        sta rt_to+2
        jmp copy_rect
@arg:   lda #RT_ERR_ARGUMENT
        jmp rt_fail
@fail:  rts

; rt_a5 rows of rt_a4 cells from rt_loc, WIN_COLS apart, to rt_to, 40 apart.
copy_rect:
        ldy #RT_D_WIN_COLS
        lda (rt_desc),y
        sta rt_t0
        iny
        lda (rt_desc),y
        sta rt_t1
        lda rt_a4
        sta rt_len
        stz rt_len+1
        stz rt_len+2
        lda rt_loc+2
        bmi @bank
        lda #40
        sta rt_t2
        stz rt_t3
        lda rt_a5
        jmp rt_copy_rows
@bank:  lda rt_a5                   ; from a bank: the CPU copies each row
        sta rt_t2
@row:   jsr rt_copy                 ; keeps rt_loc and rt_to
        lda rt_t0
        sta rt_prod
        lda rt_t1
        sta rt_prod+1
        stz rt_prod+2
        ldx #rt_loc
        jsr rt_add_loc
        clc
        lda rt_to
        adc #40
        sta rt_to
        bcc :+
        inc rt_to+1
        bne :+
        inc rt_to+2
:       lda rt_a4
        sta rt_len
        dec rt_t2
        bne @row
        clc
        rts

; rt_to = MIA_BG_NT + (table * 25 + trow) * 40 + tcol
table_at:
        lda #25
        sta rt_mul
        stz rt_mul+1
        lda rt_a6
        ldx #0
        jsr rt_mul16
        clc
        lda rt_prod
        adc rt_a8
        sta rt_mul
        stz rt_mul+1
        lda #40
        ldx #0
        jsr rt_mul16
        clc
        lda rt_prod
        adc rt_a7
        sta rt_prod
        bcc :+
        inc rt_prod+1
:       clc
        lda rt_prod
        adc #<MIA_BG_NT
        sta rt_to
        lda rt_prod+1
        adc #>MIA_BG_NT
        sta rt_to+1
        lda #^MIA_BG_NT
        adc #0
        sta rt_to+2
        rts

; rt_prod = WIN_COLS x WIN_ROWS: the distance from the tiles to the attributes.
half:
        ldy #RT_D_WIN_COLS
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
        jmp rt_mul16

; The rt_a4 x rt_a5 cells at (rt_a0/a1, rt_a2/a3) must be loaded: then
; rt_loc = the first one's tile. Carry set, with RT_ERR_RANGE, if not.
map_at:
        jsr rt_desc_loc
        jcs @fail
        sec                         ; columns into the window
        lda rt_a0
        ldy #RT_D_WIN_COL
        sbc (rt_desc),y
        sta rt_t0
        lda rt_a1
        iny
        sbc (rt_desc),y
        sta rt_t1
        bcc @range
        sec                         ; ...and room for the width after them
        ldy #RT_D_WIN_COLS
        lda (rt_desc),y
        sbc rt_t0
        sta rt_t2
        iny
        lda (rt_desc),y
        sbc rt_t1
        bcc @range
        tax
        lda rt_t2
        sec
        sbc rt_a4
        txa
        sbc #0
        bcc @range
        sec                         ; rows into the window
        lda rt_a2
        ldy #RT_D_WIN_ROW
        sbc (rt_desc),y
        sta rt_mul
        lda rt_a3
        iny
        sbc (rt_desc),y
        sta rt_mul+1
        bcc @range
        sec                         ; ...and room for the height
        ldy #RT_D_WIN_ROWS
        lda (rt_desc),y
        sbc rt_mul
        sta rt_t2
        iny
        lda (rt_desc),y
        sbc rt_mul+1
        bcc @range
        tax
        lda rt_t2
        sec
        sbc rt_a5
        txa
        sbc #0
        bcc @range
        ldy #RT_D_WIN_COLS          ; rows x WIN_COLS + columns
        lda (rt_desc),y
        pha
        iny
        lda (rt_desc),y
        tax
        pla
        jsr rt_mul16
        clc
        lda rt_prod
        adc rt_t0
        sta rt_prod
        lda rt_prod+1
        adc rt_t1
        sta rt_prod+1
        lda rt_prod+2
        adc #0
        sta rt_prod+2
        ldx #rt_loc
        jsr rt_add_loc
        clc
        rts
@range: lda #RT_ERR_RANGE
        jmp rt_fail
@fail:  rts

; ---------------------------------------------------------------------------
; Cells
; ---------------------------------------------------------------------------

; GetCell bg, col, row: A = tile, X = attribute.
rt_get_cell:
        jsr rt_set_desc
        jsr one_cell
        bcs @fail
        jsr rt_open_read
        jsr rt_read
        pha
        jsr rt_close_read
        jsr half
        ldx #rt_loc
        jsr rt_add_loc
        jsr rt_open_read
        jsr rt_read
        tax
        jsr rt_close_read
        pla
        clc
@fail:  rts

; SetCell bg, col, row, tile (a6), attribute (a7).
rt_set_cell:
        jsr rt_set_desc
        jsr one_cell
        bcs @fail
        lda rt_a6
        jsr put
        jsr half
        ldx #rt_loc
        jsr rt_add_loc
        lda rt_a7
        jsr put
        clc
@fail:  rts

one_cell:
        lda #1
        sta rt_a4
        sta rt_a5
        jmp map_at

; A = byte, stored at location rt_loc.
put:    pha
        ldx #2
:       lda rt_loc,x
        sta rt_to,x
        dex
        bpl :-
        jsr rt_save_bank
        jsr rt_open_write
        pla
        jsr rt_write
        jmp rt_close_read
