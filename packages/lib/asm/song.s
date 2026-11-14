; Songs: each voice's sequencer track, back to back. The sequencer reads MIA
; RAM, so a song must be loaded there to play.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; PlaySong song: points each of the song's voices at its track, loads them and
; starts them.
cl_play_song:
        jsr cl_set_desc
        jsr cl_desc_loc
        bcs @fail
        lda cl_loc+2
        bpl :+
        lda #CL_ERR_LOCATION
        jmp cl_fail
:       stz cl_t0                   ; voice mask
        ldx #0                      ; voice
@voice: phx
        txa
        asl a
        clc
        adc #CL_D_VOICES
        tay
        lda (cl_desc),y             ; the track's offset, $FFFF when none
        sta cl_prod
        iny
        lda (cl_desc),y
        sta cl_prod+1
        and cl_prod
        cmp #$FF
        beq @next
        clc                         ; SET_BASE<voice> = location + offset
        lda cl_loc
        adc cl_prod
        sta cl_prod
        lda cl_loc+1
        adc cl_prod+1
        sta cl_prod+1
        lda cl_loc+2
        adc #0
        sta cl_prod+2
        jsr cl_wait
        lda cl_prod
        sta CMD_PARAM1
        lda cl_prod+1
        sta CMD_PARAM2
        lda cl_prod+2
        sta CMD_PARAM3
        pla                         ; the voice
        pha
        tax
        clc
        adc #MIA_CMD_AUDIO_SEQ_SET_BASE0
        sta CMD_TRIGGER
        lda #1                      ; and its bit in the mask
:       dex
        bmi :+
        asl a
        bra :-
:       ora cl_t0
        sta cl_t0
@next:  plx
        inx
        cpx #4
        bne @voice
        jsr cl_audio_on
        lda #MIA_CMD_AUDIO_SEQ_LOAD
        jsr mask_command
        lda #MIA_CMD_AUDIO_SEQ_START
        jsr mask_command
        clc
@fail:  rts

; StopSong song: stops and silences the song's voices.
cl_stop_song:
        jsr cl_set_desc
        stz cl_t0
        ldx #3
@voice: txa
        asl a
        clc
        adc #CL_D_VOICES
        tay
        lda (cl_desc),y
        iny
        and (cl_desc),y
        cmp #$FF
        beq :+
        sec
:       rol cl_t0                   ; voice 3 first: it ends in bit 3
        dex
        bpl @voice
        lda #MIA_CMD_AUDIO_SEQ_STOP
        jsr mask_command
        clc
        rts

; SongPosition voice (X): A/X = its note index, Y = its sequencer status.
cl_song_position:
        txa
        asl a
        asl a
        asl a
        asl a
        clc
        adc #<(MIA_AUDIO_VOICES_OFFSET + MIA_AUDIO_VOICE_SEQ_NOTE_INDEX_L)
        sta cl_loc
        lda #>(MIA_AUDIO_VOICES_OFFSET + MIA_AUDIO_VOICE_SEQ_NOTE_INDEX_L)
        sta cl_loc+1
        lda #^(MIA_AUDIO_VOICES_OFFSET + MIA_AUDIO_VOICE_SEQ_NOTE_INDEX_L)
        sta cl_loc+2
        ldx #cl_loc
        lda #(1 << IDX_FLAG_R_STP_ENA)
        jsr cl_seek_a
        lda IDXA_PORT
        pha
        ldx IDXA_PORT
        ldy IDXA_PORT
        pla
        clc
        rts

; A = command, sent with the voice mask in cl_t0 unless it is empty.
mask_command:
        ldx cl_t0
        beq @none
        jsr cl_wait
        stx CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        sta CMD_TRIGGER
@none:  rts
