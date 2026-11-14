; Library internals: the helpers the routines share. .global exports a
; symbol from the module that defines it and imports it everywhere else.
; MIA's registers, ids and RAM layout come from mia.inc, which the SDK
; generates from its specs (clementina.inc includes it).
.include "clementina-lib.inc"
.macpack longbranch

; Checks: nonzero makes routines validate their arguments (the build's
; `checks` option). Zero leaves the checks out.
.ifndef CL_CHECKS
CL_CHECKS = 1
.endif

.include "clementina.inc"

; The library's own index descriptors: A reads and is the copy source, B
; writes and is the copy destination.
CL_IDX_A      = $40
CL_IDX_B      = $41
CL_FS_HANDLE  = 15          ; the file slot bank loads use

; Scratch in the library's zero page (zp.s)
.globalzp cl_desc, cl_ptr, cl_cpu, cl_loc, cl_to, cl_len, cl_mul, cl_prod
.globalzp cl_t0, cl_t1, cl_t2, cl_t3, cl_t4, cl_t5, cl_bank, cl_mode

; core.s: command synchronization and byte transfers
.global cl_wait, cl_fail
.global cl_copy_rows, cl_copy
.global cl_open_read, cl_read, cl_close_read, cl_open_write, cl_write, cl_bank_select, cl_save_bank
; mia-index.s: the two MIA index windows
.global cl_seek_a, cl_seek_b, cl_step_a, cl_step_b, cl_limit_a
.global cl_poke, cl_peek
; location.s: descriptor locations and arithmetic
.global cl_set_desc
.global cl_desc_loc, cl_desc_default, cl_set_desc_loc, cl_loc_equals_to, cl_check_loc
.global cl_mul16, cl_add_loc
; load.s: whole-asset job handling; sd-load.s: the transfer engine
.global cl_sd_part, cl_load_idle
.global cl_mia_part, cl_bank_part, cl_check_part
.global cl_sd_off, cl_sd_rowlen, cl_sd_rows, cl_sd_fstride, cl_sd_dest, cl_sd_dstride
; items.s: a sprite file's shapes and animations
.global cl_items_each, cl_item, cl_item_loc
; audio.s
.global cl_audio_on, cl_voice_command

; A command with its parameters: waits for MIA to be idle first.
.macro cl_command id, p1, p2, p3
        jsr cl_wait
        lda p1
        sta CMD_PARAM1
        lda p2
        sta CMD_PARAM2
        lda p3
        sta CMD_PARAM3
        lda id
        sta CMD_TRIGGER
.endmacro

; ldy #field / lda (cl_desc),y
.macro cl_field field
        ldy #field
        lda (cl_desc),y
.endmacro
