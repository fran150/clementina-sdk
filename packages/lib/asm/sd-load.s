; SD transfer engine: FS_LOAD_PART for MIA RAM; FS_READ chunks copied through
; the transfer buffer for bank targets. Loads are not interrupt-safe.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "BSS"
cl_sd_off:     .res 3       ; file offset of the first row
cl_sd_rowlen:  .res 3       ; bytes in a row
cl_sd_rows:    .res 2       ; rows, at least 1
cl_sd_fstride: .res 3       ; file offset from one row to the next
cl_sd_dest:    .res 3       ; location of the first row
cl_sd_dstride: .res 3       ; location step from one row to the next
chunk:         .res 2       ; bytes the last FS_READ returned
left:          .res 3       ; bytes of the row still to read
row:           .res 2       ; rows still to read

.segment "CODE"

; ---------------------------------------------------------------------------
; cl_sd_part: moves the rows the cl_sd_* variables describe from the
; asset's file (cl_desc) and waits for them. Carry set on failure. Call
; cl_load_idle before setting the variables.
; ---------------------------------------------------------------------------
cl_sd_part:
        lda cl_sd_dest+2
        jmi cl_bank_part
        jsr cl_mia_part
        bcs @fail
        jmp cl_check_part
@fail:  rts

; Into MIA RAM: one FS_LOAD_PART, left running.
cl_mia_part:
        jsr mount_card
        jcs @fail
        jsr write_asset_path
        lda #MIA_SD_CONTROL_DEST_ADDR_L
        jsr select_write_field
        ldx #0
:       lda cl_sd_dest,x
        sta IDXB_PORT
        inx
        cpx #3
        bne :-
        lda #MIA_SD_CONTROL_TRANSFER_LEN0
        jsr select_write_field
        lda cl_sd_rowlen
        sta IDXB_PORT
        lda cl_sd_rowlen+1
        sta IDXB_PORT
        lda cl_sd_rowlen+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda #MIA_SD_CONTROL_PART_OFFSET0                ; offset, rows, file stride, RAM stride
        jsr select_write_field
        lda cl_sd_off
        sta IDXB_PORT
        lda cl_sd_off+1
        sta IDXB_PORT
        lda cl_sd_off+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda cl_sd_rows
        sta IDXB_PORT
        lda cl_sd_rows+1
        sta IDXB_PORT
        lda cl_sd_fstride
        sta IDXB_PORT
        lda cl_sd_fstride+1
        sta IDXB_PORT
        lda cl_sd_fstride+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda cl_sd_dstride
        sta IDXB_PORT
        lda cl_sd_dstride+1
        sta IDXB_PORT
        lda cl_sd_dstride+2
        sta IDXB_PORT
        lda #MIA_CMD_FS_LOAD_PART
        jsr send_card_command
        clc
@fail:  rts

; Waits for cl_mia_part's job and checks it loaded every byte: rows x rowlen.
cl_check_part:
        jsr wait_card_job
        bne fail_file
        lda cl_sd_rows+1            ; expected count
        bne @many
        lda cl_sd_rows
        cmp #1
        bne @many
        ldx #2
:       lda cl_sd_rowlen,x
        sta cl_prod,x
        dex
        bpl :-
        bra @count
@many:  lda cl_sd_rowlen
        sta cl_mul
        lda cl_sd_rowlen+1
        sta cl_mul+1
        lda cl_sd_rows
        ldx cl_sd_rows+1
        jsr cl_mul16
@count: ldx #2                      ; select_read_field uses cl_prod for its address
:       lda cl_prod,x
        pha
        dex
        bpl :-
        lda #MIA_SD_CONTROL_FILE_POS0
        jsr select_read_field
        ldx #0
:       pla
        sta cl_prod,x
        inx
        cpx #3
        bne :-
        ldx #0
:       lda IDXA_PORT
        cmp cl_prod,x
        bne fail_file
        inx
        cpx #3
        bne :-
        lda IDXA_PORT
        bne fail_file
        clc
        rts
fail_file:
        lda #CL_ERR_FILE
        jmp cl_fail

; Into a bank: open the file on the library's slot, then per row seek and
; read chunks through the transfer buffer.
cl_bank_part:
        jsr mount_card
        jcs @fail
        lda #MIA_SD_CONTROL_HANDLE_SELECT
        jsr select_write_field
        lda #CL_FS_HANDLE
        sta IDXB_PORT
        lda #MIA_CMD_FS_CLOSE           ; in case a failed load left it open
        jsr send_card_command
        jsr wait_card_job
        jsr write_asset_path
        lda #MIA_SD_CONTROL_OPEN_MODE
        jsr select_write_field
        stz IDXB_PORT               ; read
        lda #MIA_CMD_FS_OPEN
        jsr send_card_command
        jsr wait_card_job
        bne fail_file
        lda cl_sd_rows
        sta row
        lda cl_sd_rows+1
        sta row+1
@row:   lda #MIA_SD_CONTROL_FILE_POS0
        jsr select_write_field
        lda cl_sd_off
        sta IDXB_PORT
        lda cl_sd_off+1
        sta IDXB_PORT
        lda cl_sd_off+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda #MIA_CMD_FS_SEEK
        jsr send_card_command
        jsr wait_card_job
        jne @error
        ldx #2
:       lda cl_sd_rowlen,x
        sta left,x
        lda cl_sd_dest,x
        sta cl_to,x
        dex
        bpl :-
@chunk: lda left+2                  ; ask for min(left, 1984)
        bne @full
        lda left+1
        cmp #>MIA_FS_TRANSFER_SIZE
        bcc @part
        bne @full
        lda left
        cmp #<MIA_FS_TRANSFER_SIZE
        bcc @part
@full:  lda #<MIA_FS_TRANSFER_SIZE
        ldx #>MIA_FS_TRANSFER_SIZE
        bra @ask
@part:  lda left
        ldx left+1
@ask:   pha
        phx
        lda #MIA_SD_CONTROL_REQUEST_LEN_L
        jsr select_write_field
        plx
        pla
        sta IDXB_PORT
        stx IDXB_PORT
        lda #MIA_CMD_FS_READ
        jsr send_card_command
        jsr wait_card_job
        jne @error
        lda #MIA_SD_CONTROL_RESULT_LEN_L
        jsr select_read_field
        lda IDXA_PORT
        sta chunk
        lda IDXA_PORT
        sta chunk+1
        ora chunk
        jeq @error                  ; the file ended early
        lda #<MIA_FS_TRANSFER_OFFSET
        sta cl_loc
        lda #>MIA_FS_TRANSFER_OFFSET
        sta cl_loc+1
        lda #^MIA_FS_TRANSFER_OFFSET
        sta cl_loc+2
        lda chunk
        sta cl_len
        sta cl_prod
        lda chunk+1
        sta cl_len+1
        sta cl_prod+1
        stz cl_len+2
        stz cl_prod+2
        jsr cl_copy                 ; leaves cl_to where it was
        ldx #cl_to
        jsr cl_add_loc
        sec
        lda left
        sbc chunk
        sta left
        lda left+1
        sbc chunk+1
        sta left+1
        lda left+2
        sbc #0
        sta left+2
        ora left+1
        ora left
        jne @chunk
        clc                         ; next row: both positions move on
        lda cl_sd_off
        adc cl_sd_fstride
        sta cl_sd_off
        lda cl_sd_off+1
        adc cl_sd_fstride+1
        sta cl_sd_off+1
        lda cl_sd_off+2
        adc cl_sd_fstride+2
        sta cl_sd_off+2
        ldx #2
:       lda cl_sd_dest,x
        sta cl_loc,x
        lda cl_sd_dstride,x
        sta cl_prod,x
        dex
        bpl :-
        ldx #cl_loc
        jsr cl_add_loc
        ldx #2
:       lda cl_loc,x
        sta cl_sd_dest,x
        dex
        bpl :-
        lda row
        bne :+
        dec row+1
:       dec row
        lda row
        ora row+1
        jne @row
        jsr close_card_file
        clc
        rts
@error: jsr close_card_file
        jmp fail_file
@fail:  rts

close_card_file:  lda #MIA_CMD_FS_CLOSE
        jsr send_card_command
        jmp wait_card_job

; ---------------------------------------------------------------------------
; The card
; ---------------------------------------------------------------------------

; Mounts the volume unless it already is. Carry set on failure.
mount_card:  lda STATUS_H
        and #>MIA_STAT_FS_MOUNTED
        bne @ok
        lda #MIA_CMD_FS_MOUNT
        jsr send_card_command
        jsr wait_card_job
        jne fail_file
@ok:    clc
        rts

; A = SD/FS command: sends it and waits until MIA has taken it.
send_card_command:
        jsr cl_wait
        stz CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        sta CMD_TRIGGER
        jmp cl_wait

; Waits for the SD job; A = its error, Z set when there is none.
wait_card_job:
        lda STATUS_H
        and #>MIA_STAT_SD_BUSY
        bne wait_card_job
        lda #MIA_SD_CONTROL_LAST_ERROR
        jsr select_read_field
        lda IDXA_PORT
        rts

; A = control block offset: window B writes from there, window A reads.
select_write_field:  sta cl_prod
        lda #>MIA_SD_CONTROL_OFFSET
        sta cl_prod+1
        lda #^MIA_SD_CONTROL_OFFSET
        sta cl_prod+2
        ldx #cl_prod
        lda #(1 << IDX_FLAG_W_STP_ENA)
        jmp cl_seek_b
select_read_field:
        sta cl_prod
        lda #>MIA_SD_CONTROL_OFFSET
        sta cl_prod+1
        lda #^MIA_SD_CONTROL_OFFSET
        sta cl_prod+2
        ldx #cl_prod
        lda #(1 << IDX_FLAG_R_STP_ENA)
        jmp cl_seek_a

; The asset's path, zero-terminated, into the path buffer.
write_asset_path:
        lda #<MIA_FS_PATH_OFFSET
        sta cl_prod
        lda #>MIA_FS_PATH_OFFSET
        sta cl_prod+1
        lda #^MIA_FS_PATH_OFFSET
        sta cl_prod+2
        ldx #cl_prod
        lda #(1 << IDX_FLAG_W_STP_ENA)
        jsr cl_seek_b
        ldy #CL_D_PATH
        lda (cl_desc),y
        sta cl_ptr
        iny
        lda (cl_desc),y
        sta cl_ptr+1
        ldy #0
:       lda (cl_ptr),y
        sta IDXB_PORT
        beq :+
        iny
        bne :-
:       rts
