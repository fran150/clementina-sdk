; Audio shared by songs and sounds.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; Starts the audio interrupt (AUDIO_ENABLE) unless it runs. Uses cl_loc.
cl_audio_on:
        lda #<(MIA_AUDIO_HEADER_OFFSET + MIA_AUDIO_HEADER_STATUS)
        sta cl_loc
        lda #>(MIA_AUDIO_HEADER_OFFSET + MIA_AUDIO_HEADER_STATUS)
        sta cl_loc+1
        lda #^(MIA_AUDIO_HEADER_OFFSET + MIA_AUDIO_HEADER_STATUS)
        sta cl_loc+2
        jsr cl_peek
        and #MIA_AUDIO_STATUS_ACTIVE
        bne @on
        jsr cl_wait
        stz CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        lda #MIA_CMD_AUDIO_ENABLE
        sta CMD_TRIGGER
@on:    rts

; A = command, X = voice: sends it with that voice's bit as the mask.
cl_voice_command:
        pha
        lda #1
:       dex
        bmi :+
        asl a
        bra :-
:       jsr cl_wait
        sta CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        pla
        sta CMD_TRIGGER
        rts
