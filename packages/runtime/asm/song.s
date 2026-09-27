; Songs: each voice's sequencer track, back to back. The sequencer reads MIA
; RAM, so a song must be loaded there to play.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; PlaySong song: points each of the song's voices at its track, loads them and
; starts them.
rt_play_song:
        jsr rt_set_desc
        jsr rt_desc_loc
        bcs @fail
        lda rt_loc+2
        bpl :+
        lda #RT_ERR_LOCATION
        jmp rt_fail
:       stz rt_t0                   ; voice mask
        ldx #0                      ; voice
@voice: phx
        txa
        asl a
        clc
        adc #RT_D_VOICES
        tay
        lda (rt_desc),y             ; the track's offset, $FFFF when none
        sta rt_prod
        iny
        lda (rt_desc),y
        sta rt_prod+1
        and rt_prod
        cmp #$FF
        beq @next
        clc                         ; SET_BASE<voice> = location + offset
        lda rt_loc
        adc rt_prod
        sta rt_prod
        lda rt_loc+1
        adc rt_prod+1
        sta rt_prod+1
        lda rt_loc+2
        adc #0
        sta rt_prod+2
        jsr rt_wait
        lda rt_prod
        sta CMD_PARAM1
        lda rt_prod+1
        sta CMD_PARAM2
        lda rt_prod+2
        sta CMD_PARAM3
        pla                         ; the voice
        pha
        tax
        clc
        adc #CMD_SEQ_SET_BASE0
        sta CMD_TRIGGER
        lda #1                      ; and its bit in the mask
:       dex
        bmi :+
        asl a
        bra :-
:       ora rt_t0
        sta rt_t0
@next:  plx
        inx
        cpx #4
        bne @voice
        jsr rt_audio_on
        lda #CMD_SEQ_LOAD
        jsr mask_command
        lda #CMD_SEQ_START
        jsr mask_command
        clc
@fail:  rts

; StopSong song: stops and silences the song's voices.
rt_stop_song:
        jsr rt_set_desc
        stz rt_t0
        ldx #3
@voice: txa
        asl a
        clc
        adc #RT_D_VOICES
        tay
        lda (rt_desc),y
        iny
        and (rt_desc),y
        cmp #$FF
        beq :+
        sec
:       rol rt_t0                   ; voice 3 first: it ends in bit 3
        dex
        bpl @voice
        lda #CMD_SEQ_STOP
        jsr mask_command
        clc
        rts

; SongPosition voice (X): A/X = its note index, Y = its sequencer status.
rt_song_position:
        txa
        asl a
        asl a
        asl a
        asl a
        clc
        adc #<(AUDIO_VOICE0 + VOICE_SEQ)
        sta rt_loc
        lda #>(AUDIO_VOICE0 + VOICE_SEQ)
        sta rt_loc+1
        lda #^(AUDIO_VOICE0 + VOICE_SEQ)
        sta rt_loc+2
        ldx #rt_loc
        lda #IXF_READ
        jsr rt_seek_a
        lda IDXA_PORT
        pha
        ldx IDXA_PORT
        ldy IDXA_PORT
        pla
        clc
        rts

; A = command, sent with the voice mask in rt_t0 unless it is empty.
mask_command:
        ldx rt_t0
        beq @none
        jsr rt_wait
        stx CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        sta CMD_TRIGGER
@none:  rts
