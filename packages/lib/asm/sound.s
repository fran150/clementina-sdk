; Sound effects: per frame, a count and that many (voice register, value)
; pairs. A voice playing a sound is taken from the sequencer (VOICE_TAKE)
; and handed back after the last entry (VOICE_RELEASE).
.setcpu "65C02"
.include "cl_internal.inc"

.segment "BSS"
at:     .res 12                     ; per voice: its next entry's location
left:   .res 8                      ; per voice: entries left; 0 when idle

.segment "CODE"

; PlaySound sound, voice (a0): plays the first entry at once.
cl_play_sound:
        jsr cl_set_desc
.if CL_CHECKS
        lda cl_a0
        cmp #4
        bcc :+
        lda #CL_ERR_ARGUMENT
        jmp cl_fail
:
.endif
        jsr cl_desc_loc
        bcs @fail
        lda cl_a0                   ; where, and how many entries
        asl a
        adc cl_a0
        tax
        lda cl_loc
        sta at,x
        lda cl_loc+1
        sta at+1,x
        lda cl_loc+2
        sta at+2,x
        lda cl_a0
        asl a
        tax
        ldy #CL_D_ENTRIES
        lda (cl_desc),y
        sta left,x
        iny
        lda (cl_desc),y
        sta left+1,x
        jsr cl_audio_on
        lda #MIA_CMD_AUDIO_VOICE_TAKE
        ldx cl_a0
        jsr cl_voice_command
        ldx cl_a0
        jmp cl_tick_sound
@fail:  rts

; TickSound voice (X): writes the next entry; A = nonzero while the sound
; goes on.
cl_tick_sound:
        cpx #4
        bcs @idle
        stx cl_t0
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
        adc cl_t0
        tax
        lda at,x
        sta cl_loc
        lda at+1,x
        sta cl_loc+1
        lda at+2,x
        sta cl_loc+2
        jsr cl_open_read
        jsr cl_read
        sta cl_t1                   ; pairs
        sta cl_t4                   ; (for the step to the next entry)
        cmp #0                      ; cl_read's flags aren't the byte's
        beq @done
@pair:  jsr cl_read                 ; register: MIA_AUDIO_VOICES_OFFSET + voice * 16 + it
        sta cl_t2
        lda cl_t0
        asl a
        asl a
        asl a
        asl a
        clc
        adc cl_t2
        adc #<MIA_AUDIO_VOICES_OFFSET
        sta cl_to
        lda #>MIA_AUDIO_VOICES_OFFSET
        sta cl_to+1
        lda #^MIA_AUDIO_VOICES_OFFSET
        sta cl_to+2
        jsr cl_read
        jsr cl_poke
        dec cl_t1
        bne @pair
@done:  jsr cl_close_read
        lda cl_t0                   ; next entry: 1 + 2 x pairs further on
        asl a
        adc cl_t0
        tax
        lda at,x
        sta cl_loc
        lda at+1,x
        sta cl_loc+1
        lda at+2,x
        sta cl_loc+2
        lda cl_t4
        stz cl_prod+1
        asl a
        rol cl_prod+1
        inc a
        sta cl_prod
        stz cl_prod+2
        phx
        ldx #cl_loc
        jsr cl_add_loc
        plx
        lda cl_loc
        sta at,x
        lda cl_loc+1
        sta at+1,x
        lda cl_loc+2
        sta at+2,x
        lda cl_t0                   ; one entry fewer
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
        lda #MIA_CMD_AUDIO_VOICE_RELEASE      ; that was the last: back to the sequencer
        ldx cl_t0
        jsr cl_voice_command
        lda #0
        clc
        rts
@more:  lda #1
        clc
        rts

; StopSound voice (X): gates it off and hands it back.
cl_stop_sound:
        stx cl_t0
        txa
        asl a
        tay
        lda left,y
        ora left+1,y
        beq @idle
        lda #0
        sta left,y
        sta left+1,y
        lda cl_t0                   ; CONTROL = 0: release
        asl a
        asl a
        asl a
        asl a
        clc
        adc #<(MIA_AUDIO_VOICES_OFFSET + MIA_AUDIO_VOICE_CONTROL)
        sta cl_to
        lda #>MIA_AUDIO_VOICES_OFFSET
        sta cl_to+1
        lda #^MIA_AUDIO_VOICES_OFFSET
        sta cl_to+2
        lda #0
        jsr cl_poke
        lda #MIA_CMD_AUDIO_VOICE_RELEASE
        ldx cl_t0
        jsr cl_voice_command
@idle:  clc
        rts
