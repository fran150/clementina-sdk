; Transfers between MIA RAM and CPU banks. The copy and stream routines
; share zero-page state (zp.s), which RuntimeSave keeps.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "CODE"

; Waits until no command and no copy is running. Every routine calls it
; before it touches MIA, so a command still reading the descriptors, or a
; copy still writing memory, never sees a later change. Keeps A, X and Y.
rt_wait:
        pha
@busy:  lda STATUS_L
        and #ST_CMD_DMA
        bne @busy
        pla
        rts

; A = error code: sets rt_error and carry.
rt_fail:
        sta rt_error
        sec
        rts
; ---------------------------------------------------------------------------
; rt_copy_rows: a DMA copy inside MIA RAM of A rows (0: 256) of rt_len bytes
; (16-bit, not 0), from rt_loc to rt_to. Row starts are rt_t0/rt_t1 bytes
; apart in the source and rt_t2/rt_t3 in the destination. Returns once the
; command is sent; the copy runs on. Uses rt_prod.
; ---------------------------------------------------------------------------
rt_copy_rows:
        pha
        ldx #rt_to
        lda #0
        jsr rt_seek_b
        lda rt_t2
        ldy rt_t3
        jsr rt_step_b
        ldx #rt_loc
        lda #0
        jsr rt_seek_a
        lda rt_t0
        ldy rt_t1
        jsr rt_step_a
        clc                     ; a row ends at the source's limit
        lda rt_loc
        adc rt_len
        sta rt_prod
        lda rt_loc+1
        adc rt_len+1
        sta rt_prod+1
        lda rt_loc+2
        adc #0
        sta rt_prod+2
        ldx #rt_prod
        jsr rt_limit_a
        pla
        sta CMD_PARAM3
        lda #RT_IDX_A
        sta CMD_PARAM1
        lda #RT_IDX_B
        sta CMD_PARAM2
        lda #CMD_COPY_RECT
        sta CMD_TRIGGER
        clc
        rts

; ---------------------------------------------------------------------------
; rt_copy: rt_len bytes (24-bit) from location rt_loc to location rt_to; the
; two must not overlap. Inside MIA RAM it is DMA, in pieces of up to $FF00
; bytes; anything touching a bank goes through the CPU. Consumes rt_loc,
; rt_to and rt_len. Always succeeds (carry clear).
; ---------------------------------------------------------------------------
rt_copy:
        lda rt_len
        ora rt_len+1
        ora rt_len+2
        beq @done
        lda rt_loc+2
        jmi @from_bank
        lda rt_to+2
        bmi @to_bank
        stz rt_t0               ; one row per command: strides don't matter
        stz rt_t1
        stz rt_t2
        stz rt_t3
@dma:   lda rt_len+2
        bne @piece
        lda rt_len+1
        cmp #$FF
        bcc @last
@piece: lda rt_len              ; send $FF00 bytes, keeping the rest
        pha
        lda rt_len+1
        pha
        stz rt_len
        lda #$FF
        sta rt_len+1
        lda #1
        jsr rt_copy_rows
        pla
        sta rt_len+1
        pla
        sta rt_len
        sec
        lda rt_len+1
        sbc #$FF
        sta rt_len+1
        lda rt_len+2
        sbc #0
        sta rt_len+2
        clc
        lda rt_loc+1
        adc #$FF
        sta rt_loc+1
        bcc :+
        inc rt_loc+2
:       clc
        lda rt_to+1
        adc #$FF
        sta rt_to+1
        bcc @dma
        inc rt_to+2
        bra @dma
@last:  lda rt_len
        ora rt_len+1
        beq @done
        lda #1
        jsr rt_copy_rows
@done:  clc
        rts

@to_bank:                       ; MIA to a bank
        jsr rt_open_read
        jsr rt_open_write
        ldy rt_ptr              ; (rt_ptr),y with the pointer's low byte in Y
        stz rt_ptr
@tb:    lda IDXA_PORT
        sta (rt_ptr),y
        iny
        beq @tb_page
@tb_count:
        lda rt_len
        beq @tb_borrow
        dec rt_len
        bne @tb
        lda rt_len+1
        ora rt_len+2
        bne @tb
        bra @close
@tb_borrow:
        dec rt_len
        lda rt_len+1
        bne :+
        dec rt_len+2
:       dec rt_len+1
        bra @tb
@tb_page:
        jsr next_write_page
        bra @tb_count

@from_bank:
        lda rt_to+2
        bmi @bank_bank
        jsr rt_open_read        ; a bank to MIA
        jsr rt_open_write
        ldy rt_cpu
        stz rt_cpu
@fb:    lda (rt_cpu),y
        sta IDXB_PORT
        iny
        beq @fb_page
@fb_count:
        lda rt_len
        beq @fb_borrow
        dec rt_len
        bne @fb
        lda rt_len+1
        ora rt_len+2
        bne @fb
        bra @close
@fb_borrow:
        dec rt_len
        lda rt_len+1
        bne :+
        dec rt_len+2
:       dec rt_len+1
        bra @fb
@fb_page:
        jsr next_read_page
        bra @fb_count

@bank_bank:                     ; a bank to a bank: a byte at a time
        jsr rt_open_read
        jsr rt_open_write
@bb:    jsr rt_read
        jsr rt_write
        lda rt_len
        bne @bb_low
        lda rt_len+1
        bne @bb_mid
        dec rt_len+2
@bb_mid:
        dec rt_len+1
@bb_low:
        dec rt_len
        lda rt_len
        ora rt_len+1
        ora rt_len+2
        bne @bb
@close: jsr rt_close_read
        clc
        rts

; The read or write pointer crossed a page: at $C000 it goes on at $8000 in
; the next bank. Keep X and Y.
next_read_page:
        inc rt_cpu+1
        lda rt_cpu+1
        cmp #$C0
        bcc :+
        lda #$80
        sta rt_cpu+1
        inc rt_mode
        lda rt_mode
        jmp rt_bank_select
:       rts
next_write_page:
        inc rt_ptr+1
        lda rt_ptr+1
        cmp #$C0
        bcc :+
        lda #$80
        sta rt_ptr+1
        inc rt_t5
        lda rt_t5
        jmp rt_bank_select
:       rts

; ---------------------------------------------------------------------------
; Streams. rt_open_read starts reading at location rt_loc and rt_open_write
; writing at rt_to; then rt_read returns the next byte in A and rt_write
; stores A, both keeping X and Y. In MIA RAM they use windows A and B; in a
; bank, rt_cpu (reading) and rt_ptr (writing), going on into the next bank at
; $C000. rt_mode and rt_t5 hold each side's $80 | bank, or 0 for MIA; when
; both sides are banks, each access selects its own. rt_close_read puts back
; the bank rt_open_read found selected.
; ---------------------------------------------------------------------------
rt_open_read:
        lda VIA_ORA
        and #$1F
        sta rt_bank
        lda rt_loc+2
        bmi @bank
        stz rt_mode
        ldx #rt_loc
        lda #IXF_READ
        jmp rt_seek_a
@bank:  sta rt_mode
        jsr rt_bank_select
        lda rt_loc
        sta rt_cpu
        lda rt_loc+1
        sta rt_cpu+1
        rts

rt_open_write:
        lda rt_to+2
        bmi @bank
        stz rt_t5
        ldx #rt_to
        lda #IXF_WRITE
        jmp rt_seek_b
@bank:  sta rt_t5
        jsr rt_bank_select
        lda rt_to
        sta rt_ptr
        lda rt_to+1
        sta rt_ptr+1
        rts

rt_read:
        bit rt_mode
        bmi @bank
        lda IDXA_PORT
        rts
@bank:  bit rt_t5               ; writing to a bank as well: select ours
        bpl @read
        lda rt_mode
        jsr rt_bank_select
@read:  lda (rt_cpu)
        inc rt_cpu
        beq @page
        rts
@page:  pha
        jsr next_read_page
        pla
        rts

rt_write:
        bit rt_t5
        bmi @bank
        sta IDXB_PORT
        rts
@bank:  bit rt_mode
        bpl @write
        pha
        lda rt_t5
        jsr rt_bank_select
        pla
@write: sta (rt_ptr)
        inc rt_ptr
        beq @page
        rts
@page:  pha
        jsr next_write_page
        pla
        rts

; Remembers the selected bank for rt_close_read, when only writing: keeps X, Y.
rt_save_bank:
        lda VIA_ORA
        and #$1F
        sta rt_bank
        rts

rt_close_read:
        lda rt_bank
; A = bank (bits 0-4). PA5-PA7 are inputs, so the other bits don't matter.
rt_bank_select:
        and #$1F
        sta VIA_ORA
        rts
