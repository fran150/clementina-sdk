; SD transfer engine: FS_LOAD_PART for MIA RAM; FS_READ chunks copied through
; the transfer buffer for bank targets. Loads are not interrupt-safe.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "BSS"
rt_sd_off:     .res 3       ; file offset of the first row
rt_sd_rowlen:  .res 3       ; bytes in a row
rt_sd_rows:    .res 2       ; rows, at least 1
rt_sd_fstride: .res 3       ; file offset from one row to the next
rt_sd_dest:    .res 3       ; location of the first row
rt_sd_dstride: .res 3       ; location step from one row to the next
chunk:         .res 2       ; bytes the last FS_READ returned
left:          .res 3       ; bytes of the row still to read
row:           .res 2       ; rows still to read

.segment "CODE"

; ---------------------------------------------------------------------------
; rt_sd_part: moves the rows the rt_sd_* variables describe from the
; asset's file (rt_desc) and waits for them. Carry set on failure. Call
; rt_load_idle before setting the variables.
; ---------------------------------------------------------------------------
rt_sd_part:
        lda rt_sd_dest+2
        jmi rt_bank_part
        jsr rt_mia_part
        bcs @fail
        jmp rt_check_part
@fail:  rts

; Into MIA RAM: one FS_LOAD_PART, left running.
rt_mia_part:
        jsr mount_card
        jcs @fail
        jsr write_asset_path
        lda #SD_DEST
        jsr select_write_field
        ldx #0
:       lda rt_sd_dest,x
        sta IDXB_PORT
        inx
        cpx #3
        bne :-
        lda #SD_TRANSFER_LEN
        jsr select_write_field
        lda rt_sd_rowlen
        sta IDXB_PORT
        lda rt_sd_rowlen+1
        sta IDXB_PORT
        lda rt_sd_rowlen+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda #SD_PART                ; offset, rows, file stride, RAM stride
        jsr select_write_field
        lda rt_sd_off
        sta IDXB_PORT
        lda rt_sd_off+1
        sta IDXB_PORT
        lda rt_sd_off+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda rt_sd_rows
        sta IDXB_PORT
        lda rt_sd_rows+1
        sta IDXB_PORT
        lda rt_sd_fstride
        sta IDXB_PORT
        lda rt_sd_fstride+1
        sta IDXB_PORT
        lda rt_sd_fstride+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda rt_sd_dstride
        sta IDXB_PORT
        lda rt_sd_dstride+1
        sta IDXB_PORT
        lda rt_sd_dstride+2
        sta IDXB_PORT
        lda #CMD_FS_LOAD_PART
        jsr send_card_command
        clc
@fail:  rts

; Waits for rt_mia_part's job and checks it loaded every byte: rows x rowlen.
rt_check_part:
        jsr wait_card_job
        bne fail_file
        lda rt_sd_rows+1            ; expected count
        bne @many
        lda rt_sd_rows
        cmp #1
        bne @many
        ldx #2
:       lda rt_sd_rowlen,x
        sta rt_prod,x
        dex
        bpl :-
        bra @count
@many:  lda rt_sd_rowlen
        sta rt_mul
        lda rt_sd_rowlen+1
        sta rt_mul+1
        lda rt_sd_rows
        ldx rt_sd_rows+1
        jsr rt_mul16
@count: ldx #2                      ; select_read_field uses rt_prod for its address
:       lda rt_prod,x
        pha
        dex
        bpl :-
        lda #SD_FILE_POS
        jsr select_read_field
        ldx #0
:       pla
        sta rt_prod,x
        inx
        cpx #3
        bne :-
        ldx #0
:       lda IDXA_PORT
        cmp rt_prod,x
        bne fail_file
        inx
        cpx #3
        bne :-
        lda IDXA_PORT
        bne fail_file
        clc
        rts
fail_file:
        lda #RT_ERR_FILE
        jmp rt_fail

; Into a bank: open the file on the runtime's slot, then per row seek and
; read chunks through the transfer buffer.
rt_bank_part:
        jsr mount_card
        jcs @fail
        lda #SD_HANDLE
        jsr select_write_field
        lda #RT_FS_HANDLE
        sta IDXB_PORT
        lda #CMD_FS_CLOSE           ; in case a failed load left it open
        jsr send_card_command
        jsr wait_card_job
        jsr write_asset_path
        lda #SD_OPEN_MODE
        jsr select_write_field
        stz IDXB_PORT               ; read
        lda #CMD_FS_OPEN
        jsr send_card_command
        jsr wait_card_job
        bne fail_file
        lda rt_sd_rows
        sta row
        lda rt_sd_rows+1
        sta row+1
@row:   lda #SD_FILE_POS
        jsr select_write_field
        lda rt_sd_off
        sta IDXB_PORT
        lda rt_sd_off+1
        sta IDXB_PORT
        lda rt_sd_off+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda #CMD_FS_SEEK
        jsr send_card_command
        jsr wait_card_job
        jne @error
        ldx #2
:       lda rt_sd_rowlen,x
        sta left,x
        lda rt_sd_dest,x
        sta rt_to,x
        dex
        bpl :-
@chunk: lda left+2                  ; ask for min(left, 1984)
        bne @full
        lda left+1
        cmp #>SD_TRANSFER_SIZE
        bcc @part
        bne @full
        lda left
        cmp #<SD_TRANSFER_SIZE
        bcc @part
@full:  lda #<SD_TRANSFER_SIZE
        ldx #>SD_TRANSFER_SIZE
        bra @ask
@part:  lda left
        ldx left+1
@ask:   pha
        phx
        lda #SD_REQUEST_LEN
        jsr select_write_field
        plx
        pla
        sta IDXB_PORT
        stx IDXB_PORT
        lda #CMD_FS_READ
        jsr send_card_command
        jsr wait_card_job
        jne @error
        lda #SD_RESULT_LEN
        jsr select_read_field
        lda IDXA_PORT
        sta chunk
        lda IDXA_PORT
        sta chunk+1
        ora chunk
        jeq @error                  ; the file ended early
        lda #<SD_TRANSFER
        sta rt_loc
        lda #>SD_TRANSFER
        sta rt_loc+1
        lda #^SD_TRANSFER
        sta rt_loc+2
        lda chunk
        sta rt_len
        sta rt_prod
        lda chunk+1
        sta rt_len+1
        sta rt_prod+1
        stz rt_len+2
        stz rt_prod+2
        jsr rt_copy                 ; leaves rt_to where it was
        ldx #rt_to
        jsr rt_add_loc
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
        lda rt_sd_off
        adc rt_sd_fstride
        sta rt_sd_off
        lda rt_sd_off+1
        adc rt_sd_fstride+1
        sta rt_sd_off+1
        lda rt_sd_off+2
        adc rt_sd_fstride+2
        sta rt_sd_off+2
        ldx #2
:       lda rt_sd_dest,x
        sta rt_loc,x
        lda rt_sd_dstride,x
        sta rt_prod,x
        dex
        bpl :-
        ldx #rt_loc
        jsr rt_add_loc
        ldx #2
:       lda rt_loc,x
        sta rt_sd_dest,x
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

close_card_file:  lda #CMD_FS_CLOSE
        jsr send_card_command
        jmp wait_card_job

; ---------------------------------------------------------------------------
; The card
; ---------------------------------------------------------------------------

; Mounts the volume unless it already is. Carry set on failure.
mount_card:  lda STATUS_H
        and #STH_MOUNTED
        bne @ok
        lda #CMD_FS_MOUNT
        jsr send_card_command
        jsr wait_card_job
        jne fail_file
@ok:    clc
        rts

; A = SD/FS command: sends it and waits until MIA has taken it.
send_card_command:
        jsr rt_wait
        stz CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        sta CMD_TRIGGER
        jmp rt_wait

; Waits for the SD job; A = its error, Z set when there is none.
wait_card_job:
        lda STATUS_H
        and #STH_SD_BUSY
        bne wait_card_job
        lda #SD_LAST_ERROR
        jsr select_read_field
        lda IDXA_PORT
        rts

; A = control block offset: window B writes from there, window A reads.
select_write_field:  sta rt_prod
        lda #>SD_BLOCK
        sta rt_prod+1
        lda #^SD_BLOCK
        sta rt_prod+2
        ldx #rt_prod
        lda #IXF_WRITE
        jmp rt_seek_b
select_read_field:
        sta rt_prod
        lda #>SD_BLOCK
        sta rt_prod+1
        lda #^SD_BLOCK
        sta rt_prod+2
        ldx #rt_prod
        lda #IXF_READ
        jmp rt_seek_a

; The asset's path, zero-terminated, into the path buffer.
write_asset_path:
        lda #<SD_PATH
        sta rt_prod
        lda #>SD_PATH
        sta rt_prod+1
        lda #^SD_PATH
        sta rt_prod+2
        ldx #rt_prod
        lda #IXF_WRITE
        jsr rt_seek_b
        ldy #RT_D_PATH
        lda (rt_desc),y
        sta rt_ptr
        iny
        lda (rt_desc),y
        sta rt_ptr+1
        ldy #0
:       lda (rt_ptr),y
        sta IDXB_PORT
        beq :+
        iny
        bne :-
:       rts
