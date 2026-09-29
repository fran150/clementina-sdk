/** Token numbers copied from the Clementina ROM's active build tables. */
export const basicTokenTables = {
  primaryStart: 0x80,
  primary: [
    'END','FOR','NEXT','DATA','INPUT','DIM','READ','LET','GOTO','RUN','IF','RESTORE','GOSUB','RETURN','REM','STOP','ON','WAIT','LOAD','SAVE','DEF','POKE',
    'COLOR','FLIPX','FLIPY','ALT','STYLE','CRSR','CLS','PRINT','CONT','LIST','CLEAR','GET','NEW','TAB(','TO','FN','SPC(','THEN','NOT','STEP','+','-','*','/','^','AND','OR','>','=','<',
    'SGN','INT','ABS','USR','FRE','POS','SQR','RND','LOG','EXP','COS','SIN','TAN','ATN','PEEK','LEN','STR$','VAL','ASC','CHR$','LEFT$','RIGHT$','MID$','GO',
  ],
  mon: 0xfe,
  extensionPrefix: 0xff,
  extension: [
    'BCOLOR','SNDON','SNDOFF','SNDCLR','VOL','WAVE','NOTE','FREQ','GATE','ADSR','PULSE','PAN','BGON','BGOFF','BGMODE','BGSET','SCROLL','BGBANK','BGALT','SPRON','SPROFF','SPRCOUNT','SPRBANK','CHRMODE','CHRPLANE','PALETTE','VIDON','VIDOFF','BGCHAR','CHRLOAD','PALLOAD','OAMLOAD','SPRITE','SPRTILE','SPRX','SPRY','SPRCOLOR','SPRFLIP','SPRPRI','OPEN','CLOSE','BGET#','BPUT#',
  ],
  extension2Prefix: 0xfc,
  extension2: [
    'NTREAD','NTLOAD','NTSAVE','ATRREAD','ATRLOAD','ATRSAVE','CHRREAD','CHRSAVE','PALREAD','PALSAVE','OAMREAD','OAMSAVE','MIALOAD','MIASAVE','SEEK#','KILL','RMDIR','MKDIR','NAME','CD','DIR','INPUTMODE','KEYCLEAR','KEYREPEAT','KEYRPT','MOUSE','PADREAD','OVLON','OVLOFF','OVLBANK','OVLALT','DELAY','MPOKE','MCOPY','MFILL','FLUSH','FSTAT','BLOAD','BSAVE','SYS','TRACK','BAND','VTAKE','VGIVE',
  ],
  extensionFunctionPrefix: 0xfd,
  extensionFunction: ['PLAYING','EOF','KEYDOWN','CONSDOWN','INPUTDEV','PADON','PADDIR','PADSTICK','PADBTN','PADAXIS','PADTRIG','TICKS','MPEEK','FPOS','FSIZE','DISKFREE','CUE'],
  extensionSubtokenStart: 0x80,
} as const;

export const basicSourceLimits = {maxLineNumber: 63999, maxInputCharacters: 71} as const;
/** ROM interpreter hook used by source debuggers; synchronized with specs/basic.json. */
export const basicRuntimeDebug = {
  statementBoundaryAddress: 0x1e92,
  currentLineAddress: 0x0088,
  directModeLine: 0xffff,
} as const;
export const DATA_TOKEN = 0x83;
export const REM_TOKEN = 0x8e;
export const PRINT_TOKEN = 0x9d;
export const STYLE_MAGIC_0 = 0xce;
export const STYLE_MAGIC_1 = 0xff;
export const STYLE_MAX_BYTES = 42;
