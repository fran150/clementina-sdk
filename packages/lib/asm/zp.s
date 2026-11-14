; The library's zero page: arguments, then every byte of scratch the
; routines share. LibSave (clementina-lib.inc) keeps the whole block, so an
; interrupt handler can call routines without disturbing the main program.
.setcpu "65C02"
.include "cl_internal.inc"

.segment "ZEROPAGE"
cl_state:
cl_a0:    .res 1            ; arguments, which the macros fill
cl_a1:    .res 1
cl_a2:    .res 1
cl_a3:    .res 1
cl_a4:    .res 1
cl_a5:    .res 1
cl_a6:    .res 1
cl_a7:    .res 1
cl_a8:    .res 1
cl_a9:    .res 1
cl_a10:   .res 1
cl_a11:   .res 1
cl_desc:  .res 2            ; the descriptor being worked on
cl_ptr:   .res 2            ; a pointer: into a descriptor's tables, or a bank being written
cl_cpu:   .res 2            ; the address in a bank being read
cl_loc:   .res 3            ; a location being read
cl_to:    .res 3            ; a location being written
cl_len:   .res 3            ; a byte count
cl_mul:   .res 3            ; cl_mul16's multiplicand
cl_prod:  .res 3            ; cl_mul16's product; also scratch addresses
cl_t0:    .res 1
cl_t1:    .res 1
cl_t2:    .res 1
cl_t3:    .res 1
cl_t4:    .res 1
cl_t5:    .res 1            ; the bank being written, $80 | bank
cl_bank:  .res 1            ; the bank selected before a routine switched
cl_mode:  .res 1            ; the bank being read, $80 | bank
cl_error: .res 1            ; why the last routine failed
cl_state_end:

.assert cl_state_end - cl_state = CL_STATE_SIZE, error, "CL_STATE_SIZE in clementina-lib.inc must match the zero page block"
