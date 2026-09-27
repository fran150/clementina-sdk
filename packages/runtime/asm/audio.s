; Audio shared by songs and sounds.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; Starts the audio interrupt (AUDIO_ENABLE) unless it runs. Uses rt_loc.
rt_audio_on:
        lda #<AUDIO_STATUS
        sta rt_loc
        lda #>AUDIO_STATUS
        sta rt_loc+1
        lda #^AUDIO_STATUS
        sta rt_loc+2
        jsr rt_peek
        and #1
        bne @on
        jsr rt_wait
        stz CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        lda #CMD_AUDIO_ENABLE
        sta CMD_TRIGGER
@on:    rts

; A = command, X = voice: sends it with that voice's bit as the mask.
rt_voice_command:
        pha
        lda #1
:       dex
        bmi :+
        asl a
        bra :-
:       jsr rt_wait
        sta CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        pla
        sta CMD_TRIGGER
        rts
