; Drawing shapes into OAM, hiding sprites, and the renderer's sprite count.
; OAM records are 5 bytes: tile, X low, Y low, attribute, ext (X bits 8-9,
; Y bit 8, disable).
.setcpu "65C02"
.include "rt_internal.inc"

.segment "DATA"
; The last record the renderer scans (OAM_LAST_INDEX) as the runtime last
; set it. DrawShape only raises it; SetSpriteCount sets it.
oam_last: .byte 0

.segment "CODE"

; DrawShape file, shape (a0), sprite (a1), x (a2/a3), y (a4/a5), flips (a6):
; A = the next free sprite record.
rt_draw_shape:
        jsr rt_set_desc
.if RT_CHECKS
        lda rt_a0
        ldy #RT_D_SHAPES
        cmp (rt_desc),y
        bcc :+
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        lda rt_a0
        jsr rt_item_loc
        bcc :+
        lda #RT_ERR_NOT_LOADED
        jmp rt_fail
:       jsr rt_open_read
        jsr rt_read
        sta rt_t0                   ; sprites in the shape
.if RT_CHECKS
        clc
        adc rt_a1
        bcc :+
        beq :+                      ; exactly up to record 255
        jsr rt_close_read
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        lda rt_a1                   ; rt_to = MIA_OAM + sprite * 5
        sta rt_prod
        stz rt_prod+1
        asl a
        rol rt_prod+1
        asl a
        rol rt_prod+1
        clc
        adc rt_prod
        sta rt_prod
        bcc :+
        inc rt_prod+1
:       clc
        lda rt_prod
        adc #<MIA_OAM
        sta rt_to
        lda rt_prod+1
        adc #>MIA_OAM
        sta rt_to+1
        lda #^MIA_OAM
        adc #0
        sta rt_to+2
        ldx #rt_to
        lda #IXF_WRITE
        jsr rt_seek_b
        lda rt_t0
        jeq @end
        sta rt_t3                   ; sprites left
@sprite:
        jsr rt_read
        sta rt_t1                   ; tile
        jsr rt_read
        sta rt_mul                  ; x offset
        jsr rt_read
        sta rt_mul+1
        jsr rt_read
        sta rt_prod                 ; y offset
        jsr rt_read
        sta rt_prod+1
        jsr rt_read
        sta rt_t2                   ; attribute
        lda rt_a6                   ; mirrored about the origin: -x - 8, and
        lsr a                       ; the sprite's own flip turns over
        bcc @noflipx
        lda rt_mul
        eor #$FF
        sec
        sbc #7
        sta rt_mul
        lda rt_mul+1
        eor #$FF
        sbc #0
        sta rt_mul+1
        lda rt_t2
        eor #%00100000
        sta rt_t2
@noflipx:
        lda rt_a6
        and #2
        beq @noflipy
        lda rt_prod
        eor #$FF
        sec
        sbc #7
        sta rt_prod
        lda rt_prod+1
        eor #$FF
        sbc #0
        sta rt_prod+1
        lda rt_t2
        eor #%01000000
        sta rt_t2
@noflipy:
        clc                         ; on screen: plus the shape's position
        lda rt_mul
        adc rt_a2
        sta rt_mul
        lda rt_mul+1
        adc rt_a3
        sta rt_mul+1
        clc
        lda rt_prod
        adc rt_a4
        sta rt_prod
        lda rt_prod+1
        adc rt_a5
        sta rt_prod+1
        lda rt_mul+1                ; ext: X bits 8-9, Y bit 8
        and #3
        sta rt_t4
        lda rt_prod+1
        and #1
        asl a
        asl a
        ora rt_t4
        sta rt_t4
        clc                         ; hidden unless -8 < x < 320 and -8 < y < 200,
        lda rt_mul                  ; so a far-off sprite can't wrap into view
        adc #7
        tax
        lda rt_mul+1
        adc #0
        beq @xok
        cmp #1
        bne @hide
        cpx #<(320+7)
        bcs @hide
@xok:   clc
        lda rt_prod
        adc #7
        tax
        lda rt_prod+1
        adc #0
        bne @hide
        cpx #200+7
        bcc @show
@hide:  lda rt_t4
        ora #OAM_DISABLE
        sta rt_t4
@show:  lda rt_t1
        sta IDXB_PORT
        lda rt_mul
        sta IDXB_PORT
        lda rt_prod
        sta IDXB_PORT
        lda rt_t2
        sta IDXB_PORT
        lda rt_t4
        sta IDXB_PORT
        dec rt_t3
        jne @sprite
@end:   jsr rt_close_read
        lda rt_t0                   ; the renderer must reach the last record
        beq @done
        clc
        adc rt_a1
        dec a
        cmp oam_last
        bcc @done
        beq @done
        jsr set_last
@done:  clc
        lda rt_a1
        adc rt_t0
        clc
        rts

; HideSprites first (a0), count (a1, 0: 256): sets each record's disable bit.
rt_hide_sprites:
.if RT_CHECKS
        lda rt_a1
        beq @all
        clc
        adc rt_a0
        bcc @ok
        beq @ok
        bra @bad
@all:   lda rt_a0
        beq @ok
@bad:   lda #RT_ERR_ARGUMENT
        jmp rt_fail
@ok:
.endif
        lda rt_a0                   ; rt_to = the first record's ext byte
        sta rt_prod
        stz rt_prod+1
        asl a
        rol rt_prod+1
        asl a
        rol rt_prod+1
        clc
        adc rt_prod
        sta rt_prod
        bcc :+
        inc rt_prod+1
:       clc
        lda rt_prod
        adc #<(MIA_OAM + 4)
        sta rt_to
        lda rt_prod+1
        adc #>(MIA_OAM + 4)
        sta rt_to+1
        lda #^(MIA_OAM + 4)
        adc #0
        sta rt_to+2
        ldx #rt_to
        lda #IXF_WRITE
        jsr rt_seek_b
        lda #5                      ; one record to the next
        ldy #0
        jsr rt_step_b
        ldx rt_a1
        lda #OAM_DISABLE
:       sta IDXB_PORT
        dex
        bne :-
        clc
        rts

; SetSpriteCount count (A, 0: 256): the renderer scans records 0 to count - 1.
rt_set_sprite_count:
        dec a
set_last:
        sta oam_last
        pha
        lda #<RC_OAM_LAST
        sta rt_to
        stz rt_to+1
        stz rt_to+2
        pla
        jsr rt_poke
        clc
        rts
