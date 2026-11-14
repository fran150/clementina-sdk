; Transfers between MIA RAM and CPU banks. The copy and stream routines
; share zero-page state (zp.s), which LibSave keeps.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "CODE"

; Waits until no command and no copy is running. Every routine calls it
; before it touches MIA, so a command still reading the descriptors, or a
; copy still writing memory, never sees a later change. Keeps A, X and Y.
cl_wait:
        pha
@busy:  lda STATUS_L
        and #(MIA_STAT_CMD_RUNNING | MIA_STAT_DMA_RUNNING)
        bne @busy
        pla
        rts

; A = error code: sets cl_error and carry.
cl_fail:
        sta cl_error
        sec
        rts
; ---------------------------------------------------------------------------
; cl_copy_rows: a DMA copy inside MIA RAM of A rows (0: 256) of cl_len bytes
; (16-bit, not 0), from cl_loc to cl_to. Row starts are cl_t0/cl_t1 bytes
; apart in the source and cl_t2/cl_t3 in the destination. Returns once the
; command is sent; the copy runs on. Uses cl_prod.
; ---------------------------------------------------------------------------
cl_copy_rows:
        pha
        ldx #cl_to
        lda #0
        jsr cl_seek_b
        lda cl_t2
        ldy cl_t3
        jsr cl_step_b
        ldx #cl_loc
        lda #0
        jsr cl_seek_a
        lda cl_t0
        ldy cl_t1
        jsr cl_step_a
        clc                     ; a row ends at the source's limit
        lda cl_loc
        adc cl_len
        sta cl_prod
        lda cl_loc+1
        adc cl_len+1
        sta cl_prod+1
        lda cl_loc+2
        adc #0
        sta cl_prod+2
        ldx #cl_prod
        jsr cl_limit_a
        pla
        sta CMD_PARAM3
        lda #CL_IDX_A
        sta CMD_PARAM1
        lda #CL_IDX_B
        sta CMD_PARAM2
        lda #MIA_CMD_COPY_RECT
        sta CMD_TRIGGER
        clc
        rts

; ---------------------------------------------------------------------------
; cl_copy: cl_len bytes (24-bit) from location cl_loc to location cl_to; the
; two must not overlap. Inside MIA RAM it is DMA, in pieces of up to $FF00
; bytes; anything touching a bank goes through the CPU. Consumes cl_loc,
; cl_to and cl_len. Always succeeds (carry clear).
; ---------------------------------------------------------------------------
cl_copy:
        lda cl_len
        ora cl_len+1
        ora cl_len+2
        beq @done
        lda cl_loc+2
        jmi @from_bank
        lda cl_to+2
        bmi @to_bank
        stz cl_t0               ; one row per command: strides don't matter
        stz cl_t1
        stz cl_t2
        stz cl_t3
@dma:   lda cl_len+2
        bne @piece
        lda cl_len+1
        cmp #$FF
        bcc @last
@piece: lda cl_len              ; send $FF00 bytes, keeping the rest
        pha
        lda cl_len+1
        pha
        stz cl_len
        lda #$FF
        sta cl_len+1
        lda #1
        jsr cl_copy_rows
        pla
        sta cl_len+1
        pla
        sta cl_len
        sec
        lda cl_len+1
        sbc #$FF
        sta cl_len+1
        lda cl_len+2
        sbc #0
        sta cl_len+2
        clc
        lda cl_loc+1
        adc #$FF
        sta cl_loc+1
        bcc :+
        inc cl_loc+2
:       clc
        lda cl_to+1
        adc #$FF
        sta cl_to+1
        bcc @dma
        inc cl_to+2
        bra @dma
@last:  lda cl_len
        ora cl_len+1
        beq @done
        lda #1
        jsr cl_copy_rows
@done:  clc
        rts

@to_bank:                       ; MIA to a bank
        jsr cl_open_read
        jsr cl_open_write
        ldy cl_ptr              ; (cl_ptr),y with the pointer's low byte in Y
        stz cl_ptr
@tb:    lda IDXA_PORT
        sta (cl_ptr),y
        iny
        beq @tb_page
@tb_count:
        lda cl_len
        beq @tb_borrow
        dec cl_len
        bne @tb
        lda cl_len+1
        ora cl_len+2
        bne @tb
        bra @close
@tb_borrow:
        dec cl_len
        lda cl_len+1
        bne :+
        dec cl_len+2
:       dec cl_len+1
        bra @tb
@tb_page:
        jsr next_write_page
        bra @tb_count

@from_bank:
        lda cl_to+2
        bmi @bank_bank
        jsr cl_open_read        ; a bank to MIA
        jsr cl_open_write
        ldy cl_cpu
        stz cl_cpu
@fb:    lda (cl_cpu),y
        sta IDXB_PORT
        iny
        beq @fb_page
@fb_count:
        lda cl_len
        beq @fb_borrow
        dec cl_len
        bne @fb
        lda cl_len+1
        ora cl_len+2
        bne @fb
        bra @close
@fb_borrow:
        dec cl_len
        lda cl_len+1
        bne :+
        dec cl_len+2
:       dec cl_len+1
        bra @fb
@fb_page:
        jsr next_read_page
        bra @fb_count

@bank_bank:                     ; a bank to a bank: a byte at a time
        jsr cl_open_read
        jsr cl_open_write
@bb:    jsr cl_read
        jsr cl_write
        lda cl_len
        bne @bb_low
        lda cl_len+1
        bne @bb_mid
        dec cl_len+2
@bb_mid:
        dec cl_len+1
@bb_low:
        dec cl_len
        lda cl_len
        ora cl_len+1
        ora cl_len+2
        bne @bb
@close: jsr cl_close_read
        clc
        rts

; The read or write pointer crossed a page: at $C000 it goes on at $8000 in
; the next bank. Keep X and Y.
next_read_page:
        inc cl_cpu+1
        lda cl_cpu+1
        cmp #$C0
        bcc :+
        lda #$80
        sta cl_cpu+1
        inc cl_mode
        lda cl_mode
        jmp cl_bank_select
:       rts
next_write_page:
        inc cl_ptr+1
        lda cl_ptr+1
        cmp #$C0
        bcc :+
        lda #$80
        sta cl_ptr+1
        inc cl_t5
        lda cl_t5
        jmp cl_bank_select
:       rts

; ---------------------------------------------------------------------------
; Streams. cl_open_read starts reading at location cl_loc and cl_open_write
; writing at cl_to; then cl_read returns the next byte in A and cl_write
; stores A, both keeping X and Y. In MIA RAM they use windows A and B; in a
; bank, cl_cpu (reading) and cl_ptr (writing), going on into the next bank at
; $C000. cl_mode and cl_t5 hold each side's $80 | bank, or 0 for MIA; when
; both sides are banks, each access selects its own. cl_close_read puts back
; the bank cl_open_read found selected. cl_read's N and Z flags don't follow
; the byte (from a bank they come from stepping cl_cpu), so a caller that
; branches on the byte tests A first.
; ---------------------------------------------------------------------------
cl_open_read:
        lda VIA_ORA
        and #$1F
        sta cl_bank
        lda cl_loc+2
        bmi @bank
        stz cl_mode
        ldx #cl_loc
        lda #(1 << IDX_FLAG_R_STP_ENA)
        jmp cl_seek_a
@bank:  sta cl_mode
        jsr cl_bank_select
        lda cl_loc
        sta cl_cpu
        lda cl_loc+1
        sta cl_cpu+1
        rts

cl_open_write:
        lda cl_to+2
        bmi @bank
        stz cl_t5
        ldx #cl_to
        lda #(1 << IDX_FLAG_W_STP_ENA)
        jmp cl_seek_b
@bank:  sta cl_t5
        jsr cl_bank_select
        lda cl_to
        sta cl_ptr
        lda cl_to+1
        sta cl_ptr+1
        rts

cl_read:
        bit cl_mode
        bmi @bank
        lda IDXA_PORT
        rts
@bank:  bit cl_t5               ; writing to a bank as well: select ours
        bpl @read
        lda cl_mode
        jsr cl_bank_select
@read:  lda (cl_cpu)
        inc cl_cpu
        beq @page
        rts
@page:  pha
        jsr next_read_page
        pla
        rts

cl_write:
        bit cl_t5
        bmi @bank
        sta IDXB_PORT
        rts
@bank:  bit cl_mode
        bpl @write
        pha
        lda cl_t5
        jsr cl_bank_select
        pla
@write: sta (cl_ptr)
        inc cl_ptr
        beq @page
        rts
@page:  pha
        jsr next_write_page
        pla
        rts

; Remembers the selected bank for cl_close_read, when only writing: keeps X, Y.
cl_save_bank:
        lda VIA_ORA
        and #$1F
        sta cl_bank
        rts

cl_close_read:
        lda cl_bank
; A = bank (bits 0-4). PA5-PA7 are inputs, so the other bits don't matter.
cl_bank_select:
        and #$1F
        sta VIA_ORA
        rts
