/**
 * ca65 control commands (directives), pseudo functions and pseudo variables,
 * with a one-line syntax and summary each. Names are lowercase and keep their
 * leading dot; ca65 accepts them in any case.
 */

export type DirectiveKind = 'directive' | 'function' | 'variable';

export interface Directive {
  name: string;
  kind: DirectiveKind;
  syntax: string;
  summary: string;
  /** The directive this one is another spelling of. */
  aliasOf?: string;
}

type Entry = [string, string, string];

const directives: Entry[] = [
  ['.a16', '.a16', 'Assume a 16-bit accumulator (65816 only).'],
  ['.a8', '.a8', 'Assume an 8-bit accumulator (65816 only).'],
  ['.addr', '.addr expr[, expr...]', 'Emits 16-bit little-endian addresses.'],
  ['.align', '.align n[, fill]', 'Pads to a multiple of n bytes. The segment needs a matching `align` in the linker config.'],
  ['.asciiz', '.asciiz "text"[, ...]', 'Emits the strings, through the current character map, followed by a zero byte.'],
  ['.assert', '.assert expr, error|warning|ldwarning|lderror, "message"', 'Checks a condition when it can be evaluated, in the assembler or at link time.'],
  ['.autoimport', '.autoimport on|off', 'Imports every symbol that is used but not defined, instead of reporting it as undefined.'],
  ['.bankbytes', '.bankbytes expr[, ...]', 'Emits the bank byte (bits 16-23) of each expression.'],
  ['.bss', '.bss', 'Switches to the BSS segment: uninitialized data.'],
  ['.byte', '.byte expr|"text"[, ...]', 'Emits bytes. Strings go through the current character map.'],
  ['.byt', '.byt expr[, ...]', 'Another spelling of `.byte`.'],
  ['.case', '.case on|off', 'Turns case-sensitive identifiers on or off (on by default).'],
  ['.charmap', '.charmap char, code', 'Maps a source character to the byte strings emit for it.'],
  ['.code', '.code', 'Switches to the CODE segment.'],
  ['.condes', '.condes name, type[, priority]', 'Adds a routine to a linker-built constructor, destructor or interruptor table.'],
  ['.constructor', '.constructor name[, priority]', 'Adds a routine to the linker-built constructor table.'],
  ['.data', '.data', 'Switches to the DATA segment: initialized data.'],
  ['.dbyt', '.dbyt expr[, ...]', 'Emits 16-bit values big-endian (high byte first).'],
  ['.dbg', '.dbg file|func|line|sym, ...', 'Adds debug information, as cc65 emits it.'],
  ['.debuginfo', '.debuginfo on|off', 'Adds symbols and line info to the object file, like `--debug-info`.'],
  ['.define', '.define name[(params)] replacement', 'Defines a C-style macro that replaces a name in later lines.'],
  ['.delmacro', '.delmacro name', 'Deletes a classic macro.'],
  ['.delmac', '.delmac name', 'Another spelling of `.delmacro`.'],
  ['.destructor', '.destructor name[, priority]', 'Adds a routine to the linker-built destructor table.'],
  ['.dword', '.dword expr[, ...]', 'Emits 32-bit little-endian values.'],
  ['.else', '.else', 'Starts the part of an `.if` that is assembled when the condition is false.'],
  ['.elseif', '.elseif expr', 'Another condition for an `.if`.'],
  ['.end', '.end', 'Ends the source file: lines after it are ignored.'],
  ['.endenum', '.endenum', 'Ends an `.enum`.'],
  ['.endif', '.endif', 'Ends an `.if`.'],
  ['.endmacro', '.endmacro', 'Ends a `.macro`.'],
  ['.endmac', '.endmac', 'Another spelling of `.endmacro`.'],
  ['.endproc', '.endproc', 'Ends a `.proc`.'],
  ['.endrepeat', '.endrepeat', 'Ends a `.repeat`.'],
  ['.endrep', '.endrep', 'Another spelling of `.endrepeat`.'],
  ['.endscope', '.endscope', 'Ends a `.scope`.'],
  ['.endstruct', '.endstruct', 'Ends a `.struct`.'],
  ['.endunion', '.endunion', 'Ends a `.union`.'],
  ['.enum', '.enum [name]', 'Starts an enumeration: each line inside names a constant, counting up from 0 unless given `= value`.'],
  ['.error', '.error "message"', 'Reports an error and stops the build.'],
  ['.exitmacro', '.exitmacro', 'Leaves the macro being expanded.'],
  ['.exitmac', '.exitmac', 'Another spelling of `.exitmacro`.'],
  ['.export', '.export name[, ...] | .export name := expr', 'Makes symbols visible to other modules, which `.import` them.'],
  ['.exportzp', '.exportzp name[, ...]', 'Exports zero-page symbols.'],
  ['.faraddr', '.faraddr expr[, ...]', 'Emits 24-bit little-endian addresses.'],
  ['.fatal', '.fatal "message"', 'Reports an error and stops assembling at once.'],
  ['.feature', '.feature name[, ...]', 'Turns on a ca65 feature, such as `labels_without_colons` or `string_escapes`.'],
  ['.fileopt', '.fileopt author|comment|compiler, "text"', 'Adds an option to the object file.'],
  ['.fopt', '.fopt ...', 'Another spelling of `.fileopt`.'],
  ['.forceimport', '.forceimport name[, ...]', 'Imports symbols so the linker includes their modules even when unused.'],
  ['.global', '.global name[, ...]', 'Exports the symbols this module defines and imports the ones it does not.'],
  ['.globalzp', '.globalzp name[, ...]', 'Like `.global`, for zero-page symbols.'],
  ['.hibytes', '.hibytes expr[, ...]', 'Emits the high byte of each expression.'],
  ['.i16', '.i16', 'Assume 16-bit index registers (65816 only).'],
  ['.i8', '.i8', 'Assume 8-bit index registers (65816 only).'],
  ['.if', '.if expr', 'Assembles the lines up to `.else`, `.elseif` or `.endif` when the expression is not zero.'],
  ['.ifblank', '.ifblank tokens', 'True when there are no tokens: tests whether a macro argument was left out.'],
  ['.ifconst', '.ifconst expr', 'True when the expression is constant.'],
  ['.ifdef', '.ifdef name', 'True when the symbol is defined.'],
  ['.ifnblank', '.ifnblank tokens', 'True when there are tokens: tests whether a macro argument was given.'],
  ['.ifnconst', '.ifnconst expr', 'True when the expression is not constant.'],
  ['.ifndef', '.ifndef name', 'True when the symbol is not defined; the usual include guard.'],
  ['.ifnref', '.ifnref name', 'True when the symbol is not referenced.'],
  ['.ifp02', '.ifp02', 'True when the CPU is the 6502.'],
  ['.ifp816', '.ifp816', 'True when the CPU is the 65816.'],
  ['.ifpc02', '.ifpc02', 'True when the CPU is the 65C02.'],
  ['.ifpsc02', '.ifpsc02', 'True when the CPU is the 65SC02.'],
  ['.ifref', '.ifref name', 'True when the symbol is referenced.'],
  ['.import', '.import name[, ...]', 'Uses symbols that another module exports; the linker resolves them.'],
  ['.importzp', '.importzp name[, ...]', 'Imports zero-page symbols, so instructions use zero-page addressing.'],
  ['.incbin', '.incbin "file"[, start[, size]]', 'Emits the bytes of a binary file.'],
  ['.include', '.include "file"', 'Assembles another source file here. ca65 looks next to the including file, then in the include directories.'],
  ['.interruptor', '.interruptor name[, priority]', 'Adds a routine to the linker-built interruptor table.'],
  ['.linecont', '.linecont on|off', 'Lets a backslash at the end of a line continue it on the next.'],
  ['.list', '.list on|off', 'Turns the listing on or off.'],
  ['.listbytes', '.listbytes n|unlimited', 'Sets how many bytes a listing line shows.'],
  ['.literal', '.literal "text"[, ...]', 'Emits strings without the character map.'],
  ['.lobytes', '.lobytes expr[, ...]', 'Emits the low byte of each expression.'],
  ['.local', '.local name[, ...]', 'Inside a macro: names that are new on each expansion, for labels.'],
  ['.localchar', '.localchar char', 'Sets the character that starts cheap local labels (`@` by default).'],
  ['.macpack', '.macpack name', 'Loads one of ca65\'s macro packages, such as `generic` or `longbranch`.'],
  ['.macro', '.macro name [param, ...]', 'Starts a macro definition; `.endmacro` ends it. A macro is used like an instruction.'],
  ['.mac', '.mac name [param, ...]', 'Another spelling of `.macro`.'],
  ['.org', '.org address', 'Assembles the following code for a fixed address. Usually the linker config places code instead.'],
  ['.out', '.out "message"', 'Prints a message while assembling.'],
  ['.p02', '.p02', 'Sets the CPU to the 6502.'],
  ['.p816', '.p816', 'Sets the CPU to the 65816.'],
  ['.pagelength', '.pagelength n|unlimited', 'Sets the listing page length.'],
  ['.pagelen', '.pagelen n', 'Another spelling of `.pagelength`.'],
  ['.pc02', '.pc02', 'Sets the CPU to the 65C02, as Clementina\'s W65C02S.'],
  ['.popcpu', '.popcpu', 'Restores the CPU saved by `.pushcpu`.'],
  ['.popseg', '.popseg', 'Returns to the segment saved by `.pushseg`.'],
  ['.proc', '.proc name', 'Starts a routine with its own scope: its labels are local to it, and `name::label` reaches them from outside.'],
  ['.psc02', '.psc02', 'Sets the CPU to the 65SC02.'],
  ['.pushcpu', '.pushcpu', 'Saves the current CPU.'],
  ['.pushseg', '.pushseg', 'Saves the current segment.'],
  ['.reloc', '.reloc', 'Ends an `.org` block: code is relocatable again.'],
  ['.repeat', '.repeat count[, var]', 'Assembles the lines up to `.endrepeat` count times, with var counting from 0.'],
  ['.res', '.res count[, fill]', 'Reserves count bytes, filled with fill (zero by default).'],
  ['.rodata', '.rodata', 'Switches to the RODATA segment: read-only data.'],
  ['.scope', '.scope [name]', 'Starts a lexical scope; `.endscope` ends it. A named one is reached with `name::symbol`.'],
  ['.segment', '.segment "name"[: zeropage|absolute]', 'Switches to a segment; the linker config says where it goes.'],
  ['.set', 'name .set expr', 'Assigns a value that can be changed later, unlike `=`.'],
  ['.setcpu', '.setcpu "65C02"', 'Sets the CPU. Clementina\'s is the W65C02S: `"65C02"`.'],
  ['.smart', '.smart on|off', 'Tracks REP/SEP to guess register sizes (65816 only).'],
  ['.struct', '.struct [name]', 'Starts a structure: each line inside names a field with its storage, like `x .word`. Fields are offsets.'],
  ['.tag', '.tag struct', 'Reserves storage the size of a structure.'],
  ['.undefine', '.undefine name', 'Deletes a `.define` macro.'],
  ['.undef', '.undef name', 'Another spelling of `.undefine`.'],
  ['.union', '.union [name]', 'Like `.struct`, but every field starts at offset 0.'],
  ['.warning', '.warning "message"', 'Reports a warning.'],
  ['.word', '.word expr[, ...]', 'Emits 16-bit little-endian values.'],
  ['.zeropage', '.zeropage', 'Switches to the ZEROPAGE segment; symbols defined there use zero-page addressing.'],
];

const functions: Entry[] = [
  ['.addrsize', '.addrsize(symbol)', 'The address size of a symbol: 1 for zero page, 2 for absolute.'],
  ['.bankbyte', '.bankbyte(expr)', 'Bits 16-23 of the value; like `^expr`.'],
  ['.blank', '.blank({tokens})', 'True when the token list is empty.'],
  ['.concat', '.concat("a", "b"...)', 'Joins strings.'],
  ['.const', '.const(expr)', 'True when the expression is constant.'],
  ['.defined', '.defined(name)', 'True when the symbol is defined; `.def` is the short form.'],
  ['.def', '.def(name)', 'Another spelling of `.defined`.'],
  ['.definedmacro', '.definedmacro(name)', 'True when the macro is defined.'],
  ['.hibyte', '.hibyte(expr)', 'Bits 8-15 of the value; like `>expr`.'],
  ['.hiword', '.hiword(expr)', 'Bits 16-31 of the value.'],
  ['.ident', '.ident("name")', 'Turns a string into an identifier.'],
  ['.ismnemonic', '.ismnemonic(name)', 'True when the name is an instruction for the current CPU.'],
  ['.ismnem', '.ismnem(name)', 'Another spelling of `.ismnemonic`.'],
  ['.left', '.left(count, {tokens})', 'The first count tokens of a token list.'],
  ['.lobyte', '.lobyte(expr)', 'Bits 0-7 of the value; like `<expr`.'],
  ['.loword', '.loword(expr)', 'Bits 0-15 of the value.'],
  ['.match', '.match({a}, {b})', 'True when two token lists have the same token types.'],
  ['.max', '.max(a, b)', 'The larger value.'],
  ['.mid', '.mid(start, count, {tokens})', 'count tokens of a token list from start.'],
  ['.min', '.min(a, b)', 'The smaller value.'],
  ['.referenced', '.referenced(name)', 'True when the symbol is referenced; `.ref` is the short form.'],
  ['.ref', '.ref(name)', 'Another spelling of `.referenced`.'],
  ['.right', '.right(count, {tokens})', 'The last count tokens of a token list.'],
  ['.sizeof', '.sizeof(name)', 'The size of a structure, a structure field, a scope or a label with data.'],
  ['.sprintf', '.sprintf("format", args...)', 'Formats a string, like C\'s sprintf.'],
  ['.strat', '.strat("text", index)', 'The character code at index in a string.'],
  ['.string', '.string(name)', 'Turns an identifier or number into a string.'],
  ['.strlen', '.strlen("text")', 'The length of a string.'],
  ['.tcount', '.tcount({tokens})', 'The number of tokens in a token list.'],
  ['.xmatch', '.xmatch({a}, {b})', 'True when two token lists have the same tokens with the same values.'],
];

const variables: Entry[] = [
  ['.asize', '.asize', 'The current accumulator size in bits.'],
  ['.cpu', '.cpu', 'A number naming the current CPU.'],
  ['.isize', '.isize', 'The current index register size in bits.'],
  ['.paramcount', '.paramcount', 'Inside a macro: how many arguments it was given.'],
  ['.time', '.time', 'The time of assembly, as a Unix timestamp.'],
  ['.version', '.version', 'The ca65 version, such as 219 for 2.19.'],
];

const aliasPattern = /^Another spelling of `(\.[a-z0-9]+)`\.$/u;

const entries: Directive[] = ([['directive', directives], ['function', functions], ['variable', variables]] as const)
  .flatMap(([kind, list]) => list.map(([name, syntax, summary]): Directive => {
    const alias = aliasPattern.exec(summary)?.[1];
    return {name, kind, syntax, summary, ...(alias ? {aliasOf: alias} : {})};
  }));

/** Every ca65 directive, pseudo function and pseudo variable, keyed by lowercase name with its dot. */
export const caDirectives: ReadonlyMap<string, Directive> = new Map(entries.map(entry => [entry.name, entry]));

/** The directive for a name in any case, with or without its leading dot. */
export function directiveFor(name: string): Directive | undefined {
  const key = name.toLowerCase();
  return caDirectives.get(key.startsWith('.') ? key : `.${key}`);
}
