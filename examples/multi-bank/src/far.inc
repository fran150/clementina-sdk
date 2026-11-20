; Calling code in another bank. far_call (common.s) lives below $8000, so it
; stays mapped while it switches banks; code in a bank never switches the
; bank under itself.
; .global imports these, and exports them from common.s, which defines them.
.global far_call, print
.globalzp far_ptr, text_ptr

; FarCall routine: call a routine in any bank and come back to this one.
; A, X and Y are not kept.
.macro FarCall routine
        lda #<routine
        sta far_ptr
        lda #>routine
        sta far_ptr+1
        lda #<.bank(routine)    ; the bank ld65 put routine in (link.cfg)
        jsr far_call
.endmacro

; Print text: print the zero-terminated string at text. It works from any
; bank, for text in that bank or in the shared code.
.macro Print text
        lda #<text
        sta text_ptr
        lda #>text
        sta text_ptr+1
        jsr print
.endmacro
