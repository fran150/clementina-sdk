; Drawing shapes into OAM, hiding sprites, and the renderer's sprite count.
; OAM records are 5 bytes: tile, X low, Y low, attribute, ext (X bits 8-9,
; Y bit 8, disable).
.setcpu "65C02"
.include "cl_internal.inc"

.segment "DATA"
; The last record the renderer scans (OAM_LAST_INDEX) as the library last
; set it. DrawShape only raises it; SetSpriteCount sets it.
oam_last: .byte 0

.segment "CODE"

; DrawShape file, shape (a0), sprite (a1), x (a2/a3), y (a4/a5), flips (a6):
; A = the next free sprite record.
cl_draw_shape:
        jsr cl_set_desc
.if CL_CHECKS
        lda cl_a0
        ldy #CL_D_SHAPES
        cmp (cl_desc),y
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        lda cl_a0
        jsr cl_item_loc
        bcc :+
        lda #CL_ERR_NOT_LOADED
        jmp cl_fail
:       jsr cl_open_read
        jsr cl_read
        sta cl_t0                   ; sprites in the shape
.if CL_CHECKS
        clc
        adc cl_a1
        bcc :+
        beq :+                      ; exactly up to record 255
        jsr cl_close_read
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        lda cl_a1                   ; cl_to = MIA_VIDEO_OAM_OFFSET + sprite * 5
        sta cl_prod
        stz cl_prod+1
        asl a
        rol cl_prod+1
        asl a
        rol cl_prod+1
        clc
        adc cl_prod
        sta cl_prod
        bcc :+
        inc cl_prod+1
:       clc
        lda cl_prod
        adc #<MIA_VIDEO_OAM_OFFSET
        sta cl_to
        lda cl_prod+1
        adc #>MIA_VIDEO_OAM_OFFSET
        sta cl_to+1
        lda #^MIA_VIDEO_OAM_OFFSET
        adc #0
        sta cl_to+2
        ldx #cl_to
        lda #(1 << IDX_FLAG_W_STP_ENA)
        jsr cl_seek_b
        lda cl_t0
        jeq @end
        sta cl_t3                   ; sprites left
@sprite:
        jsr cl_read
        sta cl_t1                   ; tile
        jsr cl_read
        sta cl_mul                  ; x offset
        jsr cl_read
        sta cl_mul+1
        jsr cl_read
        sta cl_prod                 ; y offset
        jsr cl_read
        sta cl_prod+1
        jsr cl_read
        sta cl_t2                   ; attribute
        lda cl_a6                   ; mirrored about the origin: -x - 8, and
        lsr a                       ; the sprite's own flip turns over
        bcc @noflipx
        lda cl_mul
        eor #$FF
        sec
        sbc #7
        sta cl_mul
        lda cl_mul+1
        eor #$FF
        sbc #0
        sta cl_mul+1
        lda cl_t2
        eor #%00100000
        sta cl_t2
@noflipx:
        lda cl_a6
        and #2
        beq @noflipy
        lda cl_prod
        eor #$FF
        sec
        sbc #7
        sta cl_prod
        lda cl_prod+1
        eor #$FF
        sbc #0
        sta cl_prod+1
        lda cl_t2
        eor #%01000000
        sta cl_t2
@noflipy:
        clc                         ; on screen: plus the shape's position
        lda cl_mul
        adc cl_a2
        sta cl_mul
        lda cl_mul+1
        adc cl_a3
        sta cl_mul+1
        clc
        lda cl_prod
        adc cl_a4
        sta cl_prod
        lda cl_prod+1
        adc cl_a5
        sta cl_prod+1
        lda cl_mul+1                ; ext: X bits 8-9, Y bit 8
        and #3
        sta cl_t4
        lda cl_prod+1
        and #1
        asl a
        asl a
        ora cl_t4
        sta cl_t4
        clc                         ; hidden unless -8 < x < 320 and -8 < y < 200,
        lda cl_mul                  ; so a far-off sprite can't wrap into view
        adc #7
        tax
        lda cl_mul+1
        adc #0
        beq @xok
        cmp #1
        bne @hide
        cpx #<(320+7)
        bcs @hide
@xok:   clc
        lda cl_prod
        adc #7
        tax
        lda cl_prod+1
        adc #0
        bne @hide
        cpx #200+7
        bcc @show
@hide:  lda cl_t4
        ora #MIA_VIDEO_SPRITE_EXT_DISABLE
        sta cl_t4
@show:  lda cl_t1
        sta IDXB_PORT
        lda cl_mul
        sta IDXB_PORT
        lda cl_prod
        sta IDXB_PORT
        lda cl_t2
        sta IDXB_PORT
        lda cl_t4
        sta IDXB_PORT
        dec cl_t3
        jne @sprite
@end:   jsr cl_close_read
        lda cl_t0                   ; the renderer must reach the last record
        beq @done
        clc
        adc cl_a1
        dec a
        cmp oam_last
        bcc @done
        beq @done
        jsr set_last
@done:  clc
        lda cl_a1
        adc cl_t0
        clc
        rts

; HideSprites first (a0), count (a1, 0: 256): sets each record's disable bit.
cl_hide_sprites:
.if CL_CHECKS
        lda cl_a1
        beq @all
        clc
        adc cl_a0
        bcc @ok
        beq @ok
        bra @bad
@all:   lda cl_a0
        beq @ok
@bad:   lda #CL_ERR_ARGUMENT
        jmp cl_fail
@ok:
.endif
        lda cl_a0                   ; cl_to = the first record's ext byte
        sta cl_prod
        stz cl_prod+1
        asl a
        rol cl_prod+1
        asl a
        rol cl_prod+1
        clc
        adc cl_prod
        sta cl_prod
        bcc :+
        inc cl_prod+1
:       clc
        lda cl_prod
        adc #<(MIA_VIDEO_OAM_OFFSET + 4)
        sta cl_to
        lda cl_prod+1
        adc #>(MIA_VIDEO_OAM_OFFSET + 4)
        sta cl_to+1
        lda #^(MIA_VIDEO_OAM_OFFSET + 4)
        adc #0
        sta cl_to+2
        ldx #cl_to
        lda #(1 << IDX_FLAG_W_STP_ENA)
        jsr cl_seek_b
        lda #5                      ; one record to the next
        ldy #0
        jsr cl_step_b
        ldx cl_a1
        lda #MIA_VIDEO_SPRITE_EXT_DISABLE
:       sta IDXB_PORT
        dex
        bne :-
        clc
        rts

; SetSpriteCount count (A, 0: 256): the renderer scans records 0 to count - 1.
cl_set_sprite_count:
        dec a
set_last:
        sta oam_last
        pha
        lda #<MIA_VIDEO_OAM_LAST_INDEX_OFFSET
        sta cl_to
        stz cl_to+1
        stz cl_to+2
        pla
        jsr cl_poke
        clc
        rts
