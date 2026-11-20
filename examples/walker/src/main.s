; Walker: a level, a walking player, background music and a jump sound.
; Left and right walk, A jumps (just the sound), Q stops the music.
.setcpu "65C02"
.include "clementina.inc"
.include "assets.inc"
.import __BSS_RUN__, __BSS_SIZE__
.export game_start

SFX_VOICE = 3                   ; the song uses voices 0 and 1

; After a library call: carry set means it failed, and cl_error says why.
.macro Ok
        bcc :+
        jmp fail
:
.endmacro

.segment "ZEROPAGE"
ptr:        .res 2

.segment "BSS"
player:     .res CL_ANIM_SIZE
px:         .res 2
held:       .res 1              ; the controls held on the last tick
sfx_on:     .res 1

.segment "CODE"
game_start:
        cld
        jsr clear_bss

        Load PAL_MAIN
        Ok
        Load CHR_PLAYER
        Ok
        Load BG_LEVEL1
        Ok
        DrawScreen BG_LEVEL1, #0, #0, #0
        Ok
        LoadSprites SPR_PLAYER
        Ok
        Load SONG_THEME
        Ok
        Load SFX_JUMP
        Ok

        SetChrBanks #2, #2, #2, #2, #2
        SetViewport #0, #0
        SetScroll #0, #0
        SetLayers #%101

        lda #<160
        sta px
        stz px+1
        StartAnimation player, SPR_PLAYER, #ANIM_PLAYER_IDLE, #0, px, #150
        Ok
        PlaySong SONG_THEME
        Ok

loop:   WaitTick                ; once per 60 Hz tick
        TickAnimation player
        lda sfx_on
        beq pad
        TickSound #SFX_VOICE
        sta sfx_on
pad:    ReadPad #0              ; gamepad 0 and the keyboard
        tay                     ; Y = held now
        eor held                ; the controls that changed...
        sty held
        and held                ; ...and are held now: just pressed
        and #CL_PAD_A
        bne jump
        tya
        and #CL_PAD_LEFT
        bne left
        tya
        and #CL_PAD_RIGHT
        bne right
        KeyHeld #$14            ; Q
        beq loop
        StopSong SONG_THEME
        bra loop

left:   lda px
        bne :+
        dec px+1
:       dec px
        bra move
right:  inc px
        bne move
        inc px+1
move:   MoveAnimation player, px, #150
        bra loop

jump:   PlaySound SFX_JUMP, #SFX_VOICE
        lda #1
        sta sfx_on
        jmp loop                ; too far for bra

fail:   lda cl_error
        jsr KERN_PRBYTE
:       bra :-

clear_bss:
        lda #<__BSS_RUN__
        sta ptr
        lda #>__BSS_RUN__
        sta ptr+1
        ldy #0
        ldx #<__BSS_SIZE__      ; small BSS: under 256 bytes
:       lda #0
        sta (ptr),y
        iny
        dex
        bne :-
        rts
