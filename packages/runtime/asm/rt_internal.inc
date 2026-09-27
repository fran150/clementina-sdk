; Runtime internals: MIA registers, addresses and the helpers the routines
; share. .global exports a symbol from the module that defines it and
; imports it everywhere else. Sources: clementina-mia README.md, docs/sd.md,
; docs/video-output.md, docs/audio.md.
.include "runtime.inc"
.macpack longbranch

; Checks: nonzero makes routines validate their arguments (the build's
; `checks` option). Zero leaves the checks out.
.ifndef RT_CHECKS
RT_CHECKS = 1
.endif

; MIA registers
IDXA_PORT     = $FFE0
IDXA_SELECT   = $FFE1
CFG_SELECT    = $FFE2
CFG_PORT      = $FFE3
IDXB_PORT     = $FFE4
IDXB_SELECT   = $FFE5
CMD_PARAM1    = $FFE6
CMD_PARAM2    = $FFE7
CMD_PARAM3    = $FFE8
CMD_TRIGGER   = $FFE9
STATUS_L      = $FFEA
STATUS_H      = $FFEB
VIA_ORA       = $C001       ; PA0-PA4 select the bank at $8000-$BFFF

ST_CMD_DMA    = %00001100   ; STATUS_L: a command or a copy is running
STH_SD_BUSY   = %00000100   ; STATUS_H: an SD job is running
STH_MOUNTED   = %00001000   ; STATUS_H: the FAT volume is mounted

; Index descriptor configuration (CFG_SELECT ids): window A, then window B.
CFG_A_ADDR    = $00         ; low, middle, high
CFG_A_LIMIT   = $06
CFG_A_STEP    = $09         ; low, high
CFG_A_FLAGS   = $0B
CFG_B_ADDR    = $10
CFG_B_LIMIT   = $16
CFG_B_STEP    = $19
CFG_B_FLAGS   = $1B
IXF_READ      = %00000001   ; step after a read
IXF_WRITE     = %00000010   ; step after a write

; The runtime's own index descriptors: A reads and is the copy source, B
; writes and is the copy destination.
RT_IDX_A      = $40
RT_IDX_B      = $41

; Commands
CMD_COPY_INDEXES = $10
CMD_COPY_RECT    = $11
CMD_AUDIO_ENABLE = $60
CMD_SEQ_LOAD     = $63
CMD_SEQ_START    = $64
CMD_SEQ_STOP     = $65
CMD_VOICE_TAKE   = $66
CMD_VOICE_RELEASE = $67
CMD_SEQ_SET_BASE0 = $68
CMD_FS_MOUNT     = $78
CMD_FS_OPEN      = $7B
CMD_FS_READ      = $7C
CMD_FS_CLOSE     = $7D
CMD_FS_LOAD      = $7E
CMD_FS_SEEK      = $81
CMD_FS_LOAD_PART = $8A

; MIA RAM
MIA_PALETTES  = $000100
MIA_CHR       = $000200     ; + bank * 6144
MIA_BG_NT     = $00C200     ; + table * 1000
MIA_BG_ATTR   = $00E140
MIA_OVERLAY   = $010080     ; 1,000 tiles, then 1,000 attributes
MIA_OAM       = $010850     ; 5 bytes a record: tile, x, y, attr, ext
RC_LAYERS     = $000021
RC_VIEWPORT   = $000022     ; viewport mode, then active set
RC_SCROLL     = $000024     ; x, then y, 2 bytes each
RC_BANKS      = $000028     ; bg, bg alt, overlay, overlay alt, sprites
RC_1BPP_MASK  = $00002D
RC_OAM_LAST   = $000030
AUDIO_STATUS  = $012002     ; bit 0: the audio interrupt runs
AUDIO_VOICE0  = $012010     ; + voice * 16
VOICE_SEQ     = 9           ; note index (2 bytes), then status

; SD/FS control block and buffers
SD_BLOCK      = $013000
SD_LAST_ERROR = $02
SD_REQUEST_LEN = $08
SD_RESULT_LEN = $0A
SD_DEST       = $0C
SD_OPEN_MODE  = $10
SD_FILE_POS   = $1C
SD_TRANSFER_LEN = $2A
SD_HANDLE     = $2E
SD_PART       = $30         ; offset (4), rows (2), file stride (4), RAM stride (3)
SD_PATH       = $013240
SD_TRANSFER   = $013440
SD_TRANSFER_SIZE = 1984
RT_FS_HANDLE  = 15          ; the file slot bank loads use

OAM_DISABLE   = %00001000   ; ext byte

; Scratch in the runtime's zero page (zp.s)
.globalzp rt_desc, rt_ptr, rt_cpu, rt_loc, rt_to, rt_len, rt_mul, rt_prod
.globalzp rt_t0, rt_t1, rt_t2, rt_t3, rt_t4, rt_t5, rt_bank, rt_mode

; core.s
.global rt_wait, rt_fail, rt_ok, rt_set_desc
.global rt_seek_a, rt_seek_b, rt_step_a, rt_step_b, rt_limit_a
.global rt_copy_rows, rt_copy, rt_poke, rt_peek
.global rt_desc_loc, rt_desc_default, rt_set_desc_loc, rt_check_loc
.global rt_open_read, rt_read, rt_close_read, rt_open_write, rt_write, rt_bank_select, rt_save_bank
.global rt_mul16, rt_add_loc
; load.s: the SD engine
.global rt_sd_part, rt_load_idle
.global rt_sd_off, rt_sd_rowlen, rt_sd_rows, rt_sd_fstride, rt_sd_dest, rt_sd_dstride
; items.s: a sprite file's shapes and animations
.global rt_items_each, rt_item, rt_item_loc
; audio.s
.global rt_audio_on, rt_voice_command

; A command with its parameters: waits for MIA to be idle first.
.macro rt_command id, p1, p2, p3
        jsr rt_wait
        lda p1
        sta CMD_PARAM1
        lda p2
        sta CMD_PARAM2
        lda p3
        sta CMD_PARAM3
        lda id
        sta CMD_TRIGGER
.endmacro

; ldy #field / lda (rt_desc),y
.macro rt_field field
        ldy #field
        lda (rt_desc),y
.endmacro
