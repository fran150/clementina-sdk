; Sound effects: per frame, a count and that many (voice register, value)
; pairs. A voice playing a sound is taken from the sequencer (VOICE_TAKE)
; and handed back after the last entry (VOICE_RELEASE).
.setcpu "65C02"
.include "rt_internal.inc"

.segment "BSS"
at:     .res 12                     ; per voice: its next entry's location
left:   .res 8                      ; per voice: entries left; 0 when idle

.segment "CODE"

; PlaySound sound, voice (a0): plays the first entry at once.
rt_play_sound:
        jsr rt_set_desc
.if RT_CHECKS
        lda rt_a0
        cmp #4
        bcc :+
        lda #RT_ERR_ARGUMENT
        jmp rt_fail
:
.endif
        jsr rt_desc_loc
        bcs @fail
        lda rt_a0                   ; where, and how many entries
        asl a
        adc rt_a0
        tax
        lda rt_loc
        sta at,x
        lda rt_loc+1
        sta at+1,x
        lda rt_loc+2
        sta at+2,x
        lda rt_a0
        asl a
        tax
        ldy #RT_D_ENTRIES
        lda (rt_desc),y
        sta left,x
        iny
        lda (rt_desc),y
        sta left+1,x
        jsr rt_audio_on
        lda #CMD_VOICE_TAKE
        ldx rt_a0
        jsr rt_voice_command
        ldx rt_a0
        jmp rt_tick_sound
@fail:  rts

; TickSound voice (X): writes the next entry; A = nonzero while the sound
; goes on.
rt_tick_sound:
        cpx #4
        bcs @idle
        stx rt_t0
        txa
        asl a
        tay
        lda left,y
        ora left+1,y
        bne :+
@idle:  lda #0
        clc
        rts
:       txa                         ; the entry
        asl a
        adc rt_t0
        tax
        lda at,x
        sta rt_loc
        lda at+1,x
        sta rt_loc+1
        lda at+2,x
        sta rt_loc+2
        jsr rt_open_read
        jsr rt_read
        sta rt_t1                   ; pairs
        sta rt_t4                   ; (for the step to the next entry)
        beq @done
@pair:  jsr rt_read                 ; register: AUDIO_VOICE0 + voice * 16 + it
        sta rt_t2
        lda rt_t0
        asl a
        asl a
        asl a
        asl a
        clc
        adc rt_t2
        adc #<AUDIO_VOICE0
        sta rt_to
        lda #>AUDIO_VOICE0
        sta rt_to+1
        lda #^AUDIO_VOICE0
        sta rt_to+2
        jsr rt_read
        jsr rt_poke
        dec rt_t1
        bne @pair
@done:  jsr rt_close_read
        lda rt_t0                   ; next entry: 1 + 2 x pairs further on
        asl a
        adc rt_t0
        tax
        lda at,x
        sta rt_loc
        lda at+1,x
        sta rt_loc+1
        lda at+2,x
        sta rt_loc+2
        lda rt_t4
        stz rt_prod+1
        asl a
        rol rt_prod+1
        inc a
        sta rt_prod
        stz rt_prod+2
        phx
        ldx #rt_loc
        jsr rt_add_loc
        plx
        lda rt_loc
        sta at,x
        lda rt_loc+1
        sta at+1,x
        lda rt_loc+2
        sta at+2,x
        lda rt_t0                   ; one entry fewer
        asl a
        tay
        lda left,y
        bne :+
        lda left+1,y
        dec a
        sta left+1,y
        lda #0
:       dec a
        sta left,y
        ora left+1,y
        bne @more
        lda #CMD_VOICE_RELEASE      ; that was the last: back to the sequencer
        ldx rt_t0
        jsr rt_voice_command
        lda #0
        clc
        rts
@more:  lda #1
        clc
        rts

; StopSound voice (X): gates it off and hands it back.
rt_stop_sound:
        stx rt_t0
        txa
        asl a
        tay
        lda left,y
        ora left+1,y
        beq @idle
        lda #0
        sta left,y
        sta left+1,y
        lda rt_t0                   ; CONTROL = 0: release
        asl a
        asl a
        asl a
        asl a
        clc
        adc #<(AUDIO_VOICE0 + 7)
        sta rt_to
        lda #>AUDIO_VOICE0
        sta rt_to+1
        lda #^AUDIO_VOICE0
        sta rt_to+2
        lda #0
        jsr rt_poke
        lda #CMD_VOICE_RELEASE
        ldx rt_t0
        jsr rt_voice_command
@idle:  clc
        rts
