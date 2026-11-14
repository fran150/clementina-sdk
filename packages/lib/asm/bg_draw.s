; Backgrounds: drawing into the nametables, and reading or changing cells.
; What is loaded of a map is its window: WIN_COLS x WIN_ROWS cells from
; (WIN_COL, WIN_ROW), tiles row by row, then the attributes the same way.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; DrawScreen bg, col, row, table: 40 x 25 cells, or what the map has.
cl_draw_screen:
        jsr cl_set_desc
        sec                         ; columns left in the map from col
        ldy #CL_D_WIDTH
        lda (cl_desc),y
        sbc cl_a0
        sta cl_t0
        iny
        lda (cl_desc),y
        sbc cl_a1
        bcc @range
        bne @wide
        lda cl_t0
        beq @range
        cmp #40
        bcc :+
@wide:  lda #40
:       sta cl_a4
        sec                         ; rows left from row
        ldy #CL_D_HEIGHT
        lda (cl_desc),y
        sbc cl_a2
        sta cl_t0
        iny
        lda (cl_desc),y
        sbc cl_a3
        bcc @range
        bne @tall
        lda cl_t0
        beq @range
        cmp #25
        bcc :+
@tall:  lda #25
:       sta cl_a5
        stz cl_a7
        stz cl_a8
        bra draw
@range: lda #CL_ERR_RANGE
        jmp cl_fail

; DrawColumn and DrawRow: a rectangle one cell wide or high.
cl_draw_column:
        jsr cl_set_desc
        lda #1
        sta cl_a4
        bra draw
cl_draw_row:
        jsr cl_set_desc
        lda #1
        sta cl_a5
        bra draw

; DrawRect bg, col (a0/a1), row (a2/a3), width (a4), height (a5), table (a6),
; tcol (a7), trow (a8).
cl_draw_rect:
        jsr cl_set_desc
draw:
.if CL_CHECKS
        lda cl_a4
        beq @arg
        lda cl_a5
        beq @arg
        lda cl_a6
        cmp #8
        bcs @arg
        clc
        lda cl_a7
        adc cl_a4
        cmp #41
        bcs @arg
        clc
        lda cl_a8
        adc cl_a5
        cmp #26
        bcs @arg
.endif
        jsr map_at
        bcs @fail
        jsr table_at
        ldx #2                      ; tiles, keeping both ends for the attributes
:       lda cl_loc,x
        pha
        lda cl_to,x
        pha
        dex
        bpl :-
        jsr copy_rect
        ldx #0
:       pla
        sta cl_to,x
        pla
        sta cl_loc,x
        inx
        cpx #3
        bne :-
        jsr half                    ; attributes: after the window's tiles...
        ldx #cl_loc
        jsr cl_add_loc
        clc                         ; ...and in the attribute table
        lda cl_to
        adc #<(MIA_VIDEO_BG_ATTR_OFFSET - MIA_VIDEO_BG_NT_OFFSET)
        sta cl_to
        lda cl_to+1
        adc #>(MIA_VIDEO_BG_ATTR_OFFSET - MIA_VIDEO_BG_NT_OFFSET)
        sta cl_to+1
        lda cl_to+2
        adc #^(MIA_VIDEO_BG_ATTR_OFFSET - MIA_VIDEO_BG_NT_OFFSET)
        sta cl_to+2
        jmp copy_rect
@arg:   lda #CL_ERR_ARGUMENT
        jmp cl_fail
@fail:  rts

; cl_a5 rows of cl_a4 cells from cl_loc, WIN_COLS apart, to cl_to, 40 apart.
copy_rect:
        ldy #CL_D_WIN_COLS
        lda (cl_desc),y
        sta cl_t0
        iny
        lda (cl_desc),y
        sta cl_t1
        lda cl_a4
        sta cl_len
        stz cl_len+1
        stz cl_len+2
        lda cl_loc+2
        bmi @bank
        lda #40
        sta cl_t2
        stz cl_t3
        lda cl_a5
        jmp cl_copy_rows
@bank:  lda cl_a5                   ; from a bank: the CPU copies each row
        sta cl_t2
@row:   jsr cl_copy                 ; keeps cl_loc and cl_to
        lda cl_t0
        sta cl_prod
        lda cl_t1
        sta cl_prod+1
        stz cl_prod+2
        ldx #cl_loc
        jsr cl_add_loc
        clc
        lda cl_to
        adc #40
        sta cl_to
        bcc :+
        inc cl_to+1
        bne :+
        inc cl_to+2
:       lda cl_a4
        sta cl_len
        dec cl_t2
        bne @row
        clc
        rts

; cl_to = MIA_VIDEO_BG_NT_OFFSET + (table * 25 + trow) * 40 + tcol
table_at:
        lda #25
        sta cl_mul
        stz cl_mul+1
        lda cl_a6
        ldx #0
        jsr cl_mul16
        clc
        lda cl_prod
        adc cl_a8
        sta cl_mul
        stz cl_mul+1
        lda #40
        ldx #0
        jsr cl_mul16
        clc
        lda cl_prod
        adc cl_a7
        sta cl_prod
        bcc :+
        inc cl_prod+1
:       clc
        lda cl_prod
        adc #<MIA_VIDEO_BG_NT_OFFSET
        sta cl_to
        lda cl_prod+1
        adc #>MIA_VIDEO_BG_NT_OFFSET
        sta cl_to+1
        lda #^MIA_VIDEO_BG_NT_OFFSET
        adc #0
        sta cl_to+2
        rts

; cl_prod = WIN_COLS x WIN_ROWS: the distance from the tiles to the attributes.
half:
        ldy #CL_D_WIN_COLS
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
        jmp cl_mul16

; The cl_a4 x cl_a5 cells at (cl_a0/a1, cl_a2/a3) must be loaded: then
; cl_loc = the first one's tile. Carry set, with CL_ERR_RANGE, if not.
map_at:
        jsr cl_desc_loc
        jcs @fail
        sec                         ; columns into the window
        lda cl_a0
        ldy #CL_D_WIN_COL
        sbc (cl_desc),y
        sta cl_t0
        lda cl_a1
        iny
        sbc (cl_desc),y
        sta cl_t1
        bcc @range
        sec                         ; ...and room for the width after them
        ldy #CL_D_WIN_COLS
        lda (cl_desc),y
        sbc cl_t0
        sta cl_t2
        iny
        lda (cl_desc),y
        sbc cl_t1
        bcc @range
        tax
        lda cl_t2
        sec
        sbc cl_a4
        txa
        sbc #0
        bcc @range
        sec                         ; rows into the window
        lda cl_a2
        ldy #CL_D_WIN_ROW
        sbc (cl_desc),y
        sta cl_mul
        lda cl_a3
        iny
        sbc (cl_desc),y
        sta cl_mul+1
        bcc @range
        sec                         ; ...and room for the height
        ldy #CL_D_WIN_ROWS
        lda (cl_desc),y
        sbc cl_mul
        sta cl_t2
        iny
        lda (cl_desc),y
        sbc cl_mul+1
        bcc @range
        tax
        lda cl_t2
        sec
        sbc cl_a5
        txa
        sbc #0
        bcc @range
        ldy #CL_D_WIN_COLS          ; rows x WIN_COLS + columns
        lda (cl_desc),y
        pha
        iny
        lda (cl_desc),y
        tax
        pla
        jsr cl_mul16
        clc
        lda cl_prod
        adc cl_t0
        sta cl_prod
        lda cl_prod+1
        adc cl_t1
        sta cl_prod+1
        lda cl_prod+2
        adc #0
        sta cl_prod+2
        ldx #cl_loc
        jsr cl_add_loc
        clc
        rts
@range: lda #CL_ERR_RANGE
        jmp cl_fail
@fail:  rts

; ---------------------------------------------------------------------------
; Cells
; ---------------------------------------------------------------------------

; GetCell bg, col, row: A = tile, X = attribute.
cl_get_cell:
        jsr cl_set_desc
        jsr one_cell
        bcs @fail
        jsr cl_open_read
        jsr cl_read
        pha
        jsr cl_close_read
        jsr half
        ldx #cl_loc
        jsr cl_add_loc
        jsr cl_open_read
        jsr cl_read
        tax
        jsr cl_close_read
        pla
        clc
@fail:  rts

; SetCell bg, col, row, tile (a6), attribute (a7).
cl_set_cell:
        jsr cl_set_desc
        jsr one_cell
        bcs @fail
        lda cl_a6
        jsr put
        jsr half
        ldx #cl_loc
        jsr cl_add_loc
        lda cl_a7
        jsr put
        clc
@fail:  rts

one_cell:
        lda #1
        sta cl_a4
        sta cl_a5
        jmp map_at

; A = byte, stored at location cl_loc.
put:    pha
        ldx #2
:       lda cl_loc,x
        sta cl_to,x
        dex
        bpl :-
        jsr cl_save_bank
        jsr cl_open_write
        pla
        jsr cl_write
        jmp cl_close_read
