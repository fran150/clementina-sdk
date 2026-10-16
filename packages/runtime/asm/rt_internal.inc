; Runtime internals: the helpers the routines share. .global exports a
; symbol from the module that defines it and imports it everywhere else.
; MIA's registers, ids and RAM layout come from mia.inc, which the SDK
; generates from its specs (clementina.inc includes it).
.include "runtime.inc"
.macpack longbranch

; Checks: nonzero makes routines validate their arguments (the build's
; `checks` option). Zero leaves the checks out.
.ifndef RT_CHECKS
RT_CHECKS = 1
.endif

.include "clementina.inc"

; The runtime's own index descriptors: A reads and is the copy source, B
; writes and is the copy destination.
RT_IDX_A      = $40
RT_IDX_B      = $41
RT_FS_HANDLE  = 15          ; the file slot bank loads use

; Scratch in the runtime's zero page (zp.s)
.globalzp rt_desc, rt_ptr, rt_cpu, rt_loc, rt_to, rt_len, rt_mul, rt_prod
.globalzp rt_t0, rt_t1, rt_t2, rt_t3, rt_t4, rt_t5, rt_bank, rt_mode

; core.s: command synchronization and byte transfers
.global rt_wait, rt_fail
.global rt_copy_rows, rt_copy
.global rt_open_read, rt_read, rt_close_read, rt_open_write, rt_write, rt_bank_select, rt_save_bank
; mia-index.s: the two MIA index windows
.global rt_seek_a, rt_seek_b, rt_step_a, rt_step_b, rt_limit_a
.global rt_poke, rt_peek
; location.s: descriptor locations and arithmetic
.global rt_set_desc
.global rt_desc_loc, rt_desc_default, rt_set_desc_loc, rt_loc_equals_to, rt_check_loc
.global rt_mul16, rt_add_loc
; load.s: whole-asset job handling; sd-load.s: the transfer engine
.global rt_sd_part, rt_load_idle
.global rt_mia_part, rt_bank_part, rt_check_part
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
