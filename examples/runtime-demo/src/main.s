; Runtime integration example. $0700: last completed check; $0701: error;
; $0702: $A5 on completion. All routine results are checked before continuing.
.setcpu "65C02"
.include "assets.inc"
.import __BSS_RUN__, __BSS_SIZE__
.export game_start, finished, failed
.segment "ZEROPAGE"
clear_ptr: .res 2
.segment "BSS"
instance: .res RT_ANIM_SIZE
.segment "RODATA"
digits: .byte 0, 0
.segment "CODE"
.macro Check number
 .local ok
 bcc ok
 lda #number
 sta $0700
 lda rt_error
 sta $0701
 jmp failed
ok:
 lda #number
 sta $0700
.endmacro
game_start:
 cld
 stz $0700
 stz $0701
 stz $0702
 ; BLOAD does not initialize BSS. The game owns initialization.
 lda #<__BSS_RUN__
 sta clear_ptr
 lda #>__BSS_RUN__
 sta clear_ptr+1
 ldx #>__BSS_SIZE__
 ldy #0
 lda #0
clear_pages:
 cpx #0
 beq clear_tail
 sta (clear_ptr),y
 iny
 bne clear_pages
 inc clear_ptr+1
 dex
 bra clear_pages
clear_tail:
 cpy #<__BSS_SIZE__
 beq cleared
 sta (clear_ptr),y
 iny
 bra clear_tail
cleared:
 Load PAL_MAIN
 Check 1
 UsePalettes PAL_MAIN
 Check 2
 UsePaletteBank PAL_MAIN, #0, #1
 Check 3
 Load CHR_PLAYER, #$81BFF0
 Check 4
 UseTileset CHR_PLAYER, #2
 Check 5
 Relocate CHR_PLAYER, #SLOT_TILESET
 Check 6
 Forget CHR_PLAYER
 Check 7
 LoadStart CHR_PLAYER
 Check 8
poll:
 LoadBusy
 bne poll
 LoadWait
 Check 9
 LoadPart CHR_PLAYER, #0, #16, #$30000
 Check 10
 Load BG_LEVEL1
 Check 11
 DrawScreen BG_LEVEL1, #0, #0, #0
 Check 12
 SetCell BG_LEVEL1, #0, #0, #7, #2
 Check 13
 GetCell BG_LEVEL1, #0, #0
 Check 14
 ; GetCell values are preserved separately below (Check changes A).
 GetCell BG_LEVEL1, #0, #0
 sta $0703
 stx $0704
 DrawRect BG_LEVEL1, #0, #0, #2, #1, #0, #1, #1
 Check 15
 DrawRow BG_LEVEL1, #0, #0, #2, #0, #1, #2
 Check 16
 DrawColumn BG_LEVEL1, #0, #0, #1, #0, #1, #3
 Check 17
 LoadRows BG_LEVEL1, #0, #1
 Check 18
 LoadColumns BG_LEVEL1, #0, #1, #SLOT_BANK
 Check 19
 GetCell BG_LEVEL1, #0, #24
 sta $0706
 stx $0707
 LoadRect BG_LEVEL1, #0, #0, #2, #1
 Check 20
 DrawRect BG_LEVEL1, #0, #0, #2, #1, #0, #0, #0
 Check 21
 Load BG_LEVEL1, #SLOT_BANK
 Check 22
 DrawScreen BG_LEVEL1, #0, #0, #1
 Check 23
 Load OVL_HUD
 Check 24
 ShowOverlay OVL_HUD
 Check 25
 FillPlaceholder OVL_HUD, #OVL_HUD_SCORE, #digits
 Check 26
 LoadSprites SPR_PLAYER
 Check 27
 ForgetShape SPR_PLAYER, #SHAPE_PLAYER_IDLE
 Check 28
 LoadShape SPR_PLAYER, #SHAPE_PLAYER_IDLE, #$81BFFC
 Check 29
 SetLayers #4               ; sprites alone for native character preview
 SetChrBanks #2, #2, #2, #2, #2
 DrawShape SPR_PLAYER, #SHAPE_PLAYER_IDLE, #0, #40, #40
 Check 30
 LoadAnimation SPR_PLAYER, #ANIM_PLAYER_IDLE
 Check 31
 ForgetShape SPR_PLAYER, #SHAPE_PLAYER_IDLE
 Check 32
 LoadAnimationShapes SPR_PLAYER, #ANIM_PLAYER_IDLE
 Check 33
 StartAnimation instance, SPR_PLAYER, #ANIM_PLAYER_IDLE, #1, #80, #80
 Check 34
 .repeat 9
 TickAnimation instance
 Check 35
 .endrepeat
 MoveAnimation instance, #88, #88
 Check 36
 StopAnimation instance
 Check 37
 HideSprites #0, #2
 Check 38
 SetSpriteCount #2
 Check 39
 Load SONG_THEME
 Check 40
 PlaySong SONG_THEME
 Check 41
 SongPosition #0
 Check 42
 StopSong SONG_THEME
 Check 43
 Load SFX_JUMP, #SLOT_BANK
 Check 44
 PlaySound SFX_JUMP, #2
 Check 45
 .repeat 4
 TickSound #2
 Check 46
 .endrepeat
 StopSound #2
 Check 47
 SetLayers #1
 Check 48
 SetChrBanks #2, #2, #2, #2, #2
 Check 49
 SetViewport #0, #0
 Check 50
 SetScroll #0, #0
 Check 51
 lda #$5A
 sta rt_a0
 RuntimeSave
 stz rt_a0
 RuntimeRestore
 lda rt_a0
 sta $0705
 lda #$A5
 sta $0702
finished:
 jmp finished
failed:
 lda rt_error
 sta $0701
 jmp failed
