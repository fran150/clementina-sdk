; Loading from the SD card. One engine moves rows of a file into a location:
; into MIA RAM it is a single FS_LOAD_PART (strided when there are several
; rows); into a bank the CPU copies each chunk out of MIA's transfer buffer,
; reading the file through its own slot (RT_FS_HANDLE).
;
; Loads keep their state in ordinary RAM: they are never interrupt-safe, so
; RuntimeSave doesn't need it.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "BSS"
rt_sd_off:     .res 3       ; file offset of the first row
rt_sd_rowlen:  .res 3       ; bytes in a row
rt_sd_rows:    .res 2       ; rows, at least 1
rt_sd_fstride: .res 3       ; file offset from one row to the next
rt_sd_dest:    .res 3       ; location of the first row
rt_sd_dstride: .res 3       ; location step from one row to the next
job_desc:      .res 2       ; the asset LoadStart left loading; high byte 0: none
job_dest:      .res 3       ; and where to
chunk:         .res 2       ; bytes the last FS_READ returned
left:          .res 3       ; bytes of the row still to read
row:           .res 2       ; rows still to read

.segment "CODE"

; ---------------------------------------------------------------------------
; Whole assets
; ---------------------------------------------------------------------------

; Load asset[, location]
rt_load:
        jsr rt_load_start
        jcc rt_load_wait
        rts
rt_load_at:
        jsr rt_load_start_at
        jcc rt_load_wait
        rts

; LoadStart asset[, location]
rt_load_start:
        jsr rt_set_desc
        jsr rt_load_idle
        jsr rt_desc_default
        bra start
rt_load_start_at:
        jsr rt_set_desc
        jsr rt_load_idle
        lda rt_a0
        sta rt_to
        lda rt_a1
        sta rt_to+1
        lda rt_a2
        sta rt_to+2
.if RT_CHECKS
        ldx #rt_to
        jsr rt_check_loc
        bcc start
        rts
.endif
start:  ldx #2                      ; the whole file is one row
@whole: stz rt_sd_off,x
        stz rt_sd_fstride,x
        stz rt_sd_dstride,x
        lda rt_to,x
        sta rt_sd_dest,x
        dex
        bpl @whole
        ldy #RT_D_SIZE
        lda (rt_desc),y
        sta rt_sd_rowlen
        iny
        lda (rt_desc),y
        sta rt_sd_rowlen+1
        iny
        lda (rt_desc),y
        sta rt_sd_rowlen+2
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
        ldy #RT_D_LOC               ; not loaded while the load runs
        lda #$FF
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        iny
        sta (rt_desc),y
        lda rt_to+2
        bmi @bank
        jsr mia_part                ; into MIA RAM: runs on its own
        bcs @fail
        lda rt_desc
        sta job_desc
        lda rt_desc+1
        sta job_desc+1
        ldx #2
:       lda rt_to,x
        sta job_dest,x
        dex
        bpl :-
        clc
        rts
@bank:  ldx #2                      ; bank_part advances its destination
:       lda rt_to,x
        sta job_dest,x
        dex
        bpl :-
        jsr bank_part
        bcs @fail
        ldx #2
:       lda job_dest,x
        sta rt_to,x
        dex
        bpl :-
        jmp after_load
@fail:  rts

; Finishes the load LoadStart began, if there is one, keeping rt_desc,
; rt_to and the arguments: the card runs one job at a time, and the
; rt_sd_* variables describe the running one. Every load calls this first.
rt_load_idle:
        lda job_desc+1
        beq @none
        lda rt_desc
        pha
        lda rt_desc+1
        pha
        ldx #2
:       lda rt_to,x
        pha
        dex
        bpl :-
        jsr rt_load_wait
        ldx #0
:       pla
        sta rt_to,x
        inx
        cpx #3
        bne :-
        pla
        sta rt_desc+1
        pla
        sta rt_desc
@none:  rts

; LoadBusy: A = nonzero while the load LoadStart began is still running.
rt_load_busy:
        lda job_desc+1
        beq @idle
        lda STATUS_H
        and #STH_SD_BUSY
@idle:  rts

; LoadWait: waits for the load LoadStart began and returns its result;
; without one, succeeds at once.
rt_load_wait:
        lda job_desc+1
        bne @job
        clc
        rts
@job:   sta rt_desc+1
        lda job_desc
        sta rt_desc
        stz job_desc+1
        ldy #RT_D_SIZE              ; the whole file should have arrived
        ldx #0
:       lda (rt_desc),y
        sta rt_sd_rowlen,x
        iny
        inx
        cpx #3
        bne :-
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
        jsr check_part              ; waits, then checks the error and the count
        bcs @fail
        ldx #2
:       lda job_dest,x
        sta rt_to,x
        dex
        bpl :-
        jmp after_load
@fail:  rts

; The asset is now at rt_to: its location, a background's window (all of
; it) and a sprite file's items.
after_load:
        jsr rt_set_desc_loc
        ldy #RT_D_TYPE
        lda (rt_desc),y
        cmp #RT_BACKGROUND
        beq @map
        cmp #RT_SPRITES
        beq @items
        clc
        rts
@map:   ldy #RT_D_WIDTH             ; window = columns 0.., rows 0.., the whole map
        ldx #4
:       lda (rt_desc),y
        pha
        iny
        dex
        bne :-
        ldy #RT_D_WIN_ROWS+1
        ldx #4
:       pla
        sta (rt_desc),y
        dey
        dex
        bne :-
        lda #0
        ldy #RT_D_WIN_COL
:       sta (rt_desc),y
        iny
        cpy #RT_D_WIN_COLS
        bne :-
        clc
        rts
@items: ldx #<place_item             ; each item is at rt_to plus its offset
        ldy #>place_item
        jmp rt_items_each

place_item:
        ldy #0
        lda (rt_ptr),y
        sta rt_prod
        iny
        lda (rt_ptr),y
        sta rt_prod+1
        iny
        lda (rt_ptr),y
        sta rt_prod+2
        ldx #2
:       lda rt_to,x
        sta rt_loc,x
        dex
        bpl :-
        ldx #rt_loc
        jsr rt_add_loc
        ldy #2
:       lda rt_loc,y
        sta (rt_cpu),y
        dey
        bpl :-
        rts

; ---------------------------------------------------------------------------
; LoadPart asset, offset, length, location: rt_a0-a2, rt_a3-a5, rt_a6-a8.
; ---------------------------------------------------------------------------
rt_load_part:
        jsr rt_set_desc
        jsr rt_load_idle
        ldx #2
:       lda rt_a0,x
        sta rt_sd_off,x
        lda rt_a3,x
        sta rt_sd_rowlen,x
        lda rt_a6,x
        sta rt_sd_dest,x
        stz rt_sd_fstride,x
        stz rt_sd_dstride,x
        dex
        bpl :-
        lda #1
        sta rt_sd_rows
        stz rt_sd_rows+1
.if RT_CHECKS
        lda rt_a6
        sta rt_to
        lda rt_a7
        sta rt_to+1
        lda rt_a8
        sta rt_to+2
        ldx #rt_to
        jsr rt_check_loc
        bcs @fail
.endif
        jmp rt_sd_part
@fail:  rts

; ---------------------------------------------------------------------------
; rt_sd_part: moves the rows the rt_sd_* variables describe from the
; asset's file (rt_desc) and waits for them. Carry set on failure. Call
; rt_load_idle before setting the variables.
; ---------------------------------------------------------------------------
rt_sd_part:
        lda rt_sd_dest+2
        jmi bank_part
        jsr mia_part
        bcs @fail
        jmp check_part
@fail:  rts

; Into MIA RAM: one FS_LOAD_PART, left running.
mia_part:
        jsr mount
        jcs @fail
        jsr put_path
        lda #SD_DEST
        jsr field
        ldx #0
:       lda rt_sd_dest,x
        sta IDXB_PORT
        inx
        cpx #3
        bne :-
        lda #SD_TRANSFER_LEN
        jsr field
        lda rt_sd_rowlen
        sta IDXB_PORT
        lda rt_sd_rowlen+1
        sta IDXB_PORT
        lda rt_sd_rowlen+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda #SD_PART                ; offset, rows, file stride, RAM stride
        jsr field
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
        jsr command
        clc
@fail:  rts

; Waits for mia_part's job and checks it loaded every byte: rows x rowlen.
check_part:
        jsr sd_wait
        bne file_error
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
@count: ldx #2                      ; read_field uses rt_prod for its address
:       lda rt_prod,x
        pha
        dex
        bpl :-
        lda #SD_FILE_POS
        jsr read_field
        ldx #0
:       pla
        sta rt_prod,x
        inx
        cpx #3
        bne :-
        ldx #0
:       lda IDXA_PORT
        cmp rt_prod,x
        bne file_error
        inx
        cpx #3
        bne :-
        lda IDXA_PORT
        bne file_error
        clc
        rts
file_error:
        lda #RT_ERR_FILE
        jmp rt_fail

; Into a bank: open the file on the runtime's slot, then per row seek and
; read chunks through the transfer buffer.
bank_part:
        jsr mount
        jcs @fail
        lda #SD_HANDLE
        jsr field
        lda #RT_FS_HANDLE
        sta IDXB_PORT
        lda #CMD_FS_CLOSE           ; in case a failed load left it open
        jsr command
        jsr sd_wait
        jsr put_path
        lda #SD_OPEN_MODE
        jsr field
        stz IDXB_PORT               ; read
        lda #CMD_FS_OPEN
        jsr command
        jsr sd_wait
        bne file_error
        lda rt_sd_rows
        sta row
        lda rt_sd_rows+1
        sta row+1
@row:   lda #SD_FILE_POS
        jsr field
        lda rt_sd_off
        sta IDXB_PORT
        lda rt_sd_off+1
        sta IDXB_PORT
        lda rt_sd_off+2
        sta IDXB_PORT
        stz IDXB_PORT
        lda #CMD_FS_SEEK
        jsr command
        jsr sd_wait
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
        jsr field
        plx
        pla
        sta IDXB_PORT
        stx IDXB_PORT
        lda #CMD_FS_READ
        jsr command
        jsr sd_wait
        jne @error
        lda #SD_RESULT_LEN
        jsr read_field
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
        jsr close
        clc
        rts
@error: jsr close
        jmp file_error
@fail:  rts

close:  lda #CMD_FS_CLOSE
        jsr command
        jmp sd_wait

; ---------------------------------------------------------------------------
; The card
; ---------------------------------------------------------------------------

; Mounts the volume unless it already is. Carry set on failure.
mount:  lda STATUS_H
        and #STH_MOUNTED
        bne @ok
        lda #CMD_FS_MOUNT
        jsr command
        jsr sd_wait
        jne file_error
@ok:    clc
        rts

; A = SD/FS command: sends it and waits until MIA has taken it.
command:
        jsr rt_wait
        stz CMD_PARAM1
        stz CMD_PARAM2
        stz CMD_PARAM3
        sta CMD_TRIGGER
        jmp rt_wait

; Waits for the SD job; A = its error, Z set when there is none.
sd_wait:
        lda STATUS_H
        and #STH_SD_BUSY
        bne sd_wait
        lda #SD_LAST_ERROR
        jsr read_field
        lda IDXA_PORT
        rts

; A = control block offset: window B writes from there, window A reads.
field:  sta rt_prod
        lda #>SD_BLOCK
        sta rt_prod+1
        lda #^SD_BLOCK
        sta rt_prod+2
        ldx #rt_prod
        lda #IXF_WRITE
        jmp rt_seek_b
read_field:
        sta rt_prod
        lda #>SD_BLOCK
        sta rt_prod+1
        lda #^SD_BLOCK
        sta rt_prod+2
        ldx #rt_prod
        lda #IXF_READ
        jmp rt_seek_a

; The asset's path, zero-terminated, into the path buffer.
put_path:
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
