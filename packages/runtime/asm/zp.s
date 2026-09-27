; The runtime's zero page: arguments, then every byte of scratch the
; routines share. RuntimeSave (runtime.inc) keeps the whole block, so an
; interrupt handler can call routines without disturbing the main program.
.setcpu "65C02"
.include "rt_internal.inc"

.segment "ZEROPAGE"
rt_state:
rt_a0:    .res 1            ; arguments, which the macros fill
rt_a1:    .res 1
rt_a2:    .res 1
rt_a3:    .res 1
rt_a4:    .res 1
rt_a5:    .res 1
rt_a6:    .res 1
rt_a7:    .res 1
rt_a8:    .res 1
rt_a9:    .res 1
rt_a10:   .res 1
rt_a11:   .res 1
rt_desc:  .res 2            ; the descriptor being worked on
rt_ptr:   .res 2            ; a pointer: into a descriptor's tables, or a bank being written
rt_cpu:   .res 2            ; the address in a bank being read
rt_loc:   .res 3            ; a location being read
rt_to:    .res 3            ; a location being written
rt_len:   .res 3            ; a byte count
rt_mul:   .res 3            ; rt_mul16's multiplicand
rt_prod:  .res 3            ; rt_mul16's product; also scratch addresses
rt_t0:    .res 1
rt_t1:    .res 1
rt_t2:    .res 1
rt_t3:    .res 1
rt_t4:    .res 1
rt_t5:    .res 1            ; the bank being written, $80 | bank
rt_bank:  .res 1            ; the bank selected before a routine switched
rt_mode:  .res 1            ; the bank being read, $80 | bank
rt_error: .res 1            ; why the last routine failed
rt_state_end:

.assert rt_state_end - rt_state = RT_STATE_SIZE, error, "RT_STATE_SIZE in runtime.inc must match the zero page block"
