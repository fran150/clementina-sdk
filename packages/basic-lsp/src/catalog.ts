export type BasicSignatureKind = 'function' | 'statement';

export interface BasicSignature {
  keyword: string;
  kind: BasicSignatureKind;
  label: string;
  parameters: string[];
}

const fn = (keyword: string, parameters: string[]): BasicSignature => ({
  keyword, kind: 'function', label: `${keyword.replace(/\($/u, '')}(${parameters.join(', ')})`, parameters,
});
const statement = (keyword: string, syntax: string, parameters: string[]): BasicSignature => ({
  keyword, kind: 'statement', label: `${keyword}${syntax ? ` ${syntax}` : ''}`, parameters,
});

/** ROM-derived callable surface. Optional arguments use a trailing `?`. */
export const basicSignatures: readonly BasicSignature[] = [
  fn('TAB(', ['column']), fn('SPC(', ['count']), fn('SGN', ['number']), fn('INT', ['number']), fn('ABS', ['number']),
  {keyword: 'FN', kind: 'function', label: 'FNname(argument)', parameters: ['argument']},
  fn('USR', ['address']), fn('FRE', ['value']), fn('POS', ['value']), fn('SQR', ['number']), fn('RND', ['number']),
  fn('LOG', ['number']), fn('EXP', ['number']), fn('COS', ['number']), fn('SIN', ['number']), fn('TAN', ['number']),
  fn('ATN', ['number']), fn('PEEK', ['address']), fn('LEN', ['string']), fn('STR$', ['number']), fn('VAL', ['string']),
  fn('ASC', ['string']), fn('CHR$', ['code']), fn('LEFT$', ['string', 'length']), fn('RIGHT$', ['string', 'length']),
  fn('MID$', ['string', 'start', 'length?']), fn('PLAYING', ['voice']), fn('EOF', ['handle']), fn('KEYDOWN', ['code']),
  fn('CONSDOWN', ['code']), fn('INPUTDEV', ['0']), fn('PADON', ['pad']), fn('PADDIR', ['pad']), fn('PADSTICK', ['pad']),
  fn('PADBTN', ['pad', 'button']), fn('PADAXIS', ['pad', 'axis']), fn('PADTRIG', ['pad', 'trigger']), fn('TICKS', ['0']),
  fn('MPEEK', ['address']), fn('FPOS', ['handle']), fn('FSIZE', ['handle']), fn('DISKFREE', ['0']), fn('CUE', ['voice']),

  statement('END', '', []), statement('FOR', 'variable=start TO end [STEP step]', ['variable', 'start', 'end', 'step?']),
  statement('NEXT', '[variable]', ['variable?']), statement('DATA', 'value[,value...]', ['value...']),
  statement('INPUT', '[prompt;] variable[,variable...]', ['prompt?', 'variable...']), statement('DIM', 'array(dimensions)[,array...]', ['array...']),
  statement('READ', 'variable[,variable...]', ['variable...']), statement('LET', 'variable=expression', ['variable', 'expression']),
  statement('GOTO', 'line', ['line']), statement('GO', 'TO line', ['line']), statement('RUN', '[line]', ['line?']),
  statement('IF', 'condition THEN line|statement', ['condition', 'line-or-statement']), statement('RESTORE', '', []),
  statement('GOSUB', 'line', ['line']), statement('RETURN', '', []), statement('REM', 'text', ['text']),
  statement('STOP', '', []), statement('ON', 'expression GOTO|GOSUB line[,line...]', ['expression', 'line...']),
  statement('WAIT', 'address,mask[,invert]', ['address', 'mask', 'invert?']), statement('LOAD', 'path', ['path']),
  statement('SAVE', 'path', ['path']), statement('DEF', 'FNname(variable)=expression', ['function', 'variable', 'expression']),
  statement('POKE', 'address,value', ['address', 'value']), statement('COLOR', 'bank', ['bank']),
  statement('FLIPX', 'enabled', ['enabled']), statement('FLIPY', 'enabled', ['enabled']), statement('ALT', 'enabled', ['enabled']),
  statement('STYLE', 'mask', ['mask']), statement('CRSR', 'column,row', ['column', 'row']), statement('CLS', '', []),
  statement('PRINT', '[expression][,|;expression...]', ['expression...']), statement('CONT', '', []),
  statement('LIST', '[start][-end]', ['start?', 'end?']), statement('CLEAR', '', []), statement('GET', 'variable', ['variable']),
  statement('NEW', '', []), statement('MON', '', []),

  statement('BCOLOR', 'bank', ['bank']), statement('SNDON', '', []), statement('SNDOFF', '', []), statement('SNDCLR', '', []),
  statement('VOL', 'level | voice,level', ['voice?', 'level']), statement('WAVE', 'voice,waveform', ['voice', 'waveform']),
  statement('NOTE', 'voice,note', ['voice', 'note']), statement('FREQ', 'voice,hz', ['voice', 'hz']),
  statement('GATE', 'voice,enabled', ['voice', 'enabled']), statement('ADSR', 'voice,attack,decay,sustain,release', ['voice', 'attack', 'decay', 'sustain', 'release']),
  statement('PULSE', 'voice,width', ['voice', 'width']), statement('PAN', 'voice,position', ['voice', 'position']),
  statement('BGON', '', []), statement('BGOFF', '', []), statement('BGMODE', 'mode', ['mode']), statement('BGSET', 'set', ['set']),
  statement('SCROLL', 'x,y', ['x', 'y']), statement('BGBANK', 'bank', ['bank']), statement('BGALT', 'bank', ['bank']),
  statement('SPRON', '', []), statement('SPROFF', '', []), statement('SPRCOUNT', 'lastIndex', ['lastIndex']),
  statement('SPRBANK', 'bank', ['bank']), statement('CHRMODE', 'bank,is1bpp', ['bank', 'is1bpp']),
  statement('CHRPLANE', 'background,sprites,overlay', ['background', 'sprites', 'overlay']),
  statement('PALETTE', 'bank,index,red,green,blue', ['bank', 'index', 'red', 'green', 'blue']),
  statement('VIDON', '', []), statement('VIDOFF', '', []), statement('BGCHAR', 'column,row,tile,attribute', ['column', 'row', 'tile', 'attribute']),
  statement('CHRLOAD', 'bank,offset,count,path', ['bank', 'offset', 'count', 'path']),
  statement('PALLOAD', 'bank,offset,count,path', ['bank', 'offset', 'count', 'path']), statement('OAMLOAD', 'index,count,path', ['index', 'count', 'path']),
  statement('SPRITE', 'index,tile,x,y,palette,flags', ['index', 'tile', 'x', 'y', 'palette', 'flags']),
  statement('SPRTILE', 'index,tile', ['index', 'tile']), statement('SPRX', 'index,x', ['index', 'x']), statement('SPRY', 'index,y', ['index', 'y']),
  statement('SPRCOLOR', 'index,palette', ['index', 'palette']), statement('SPRFLIP', 'index,flipX,flipY', ['index', 'flipX', 'flipY']),
  statement('SPRPRI', 'index,priority', ['index', 'priority']), statement('OPEN', 'path FOR mode AS #handle', ['path', 'mode', 'handle']),
  statement('CLOSE', '#handle', ['handle']), statement('BGET#', 'handle,variable', ['handle', 'variable']),
  statement('BPUT#', 'handle,value', ['handle', 'value']),

  statement('NTREAD', 'table,cell,count', ['table', 'cell', 'count']), statement('NTLOAD', 'table,cell,count,path', ['table', 'cell', 'count', 'path']),
  statement('NTSAVE', 'table,cell,count,path', ['table', 'cell', 'count', 'path']), statement('ATRREAD', 'table,cell,count', ['table', 'cell', 'count']),
  statement('ATRLOAD', 'table,cell,count,path', ['table', 'cell', 'count', 'path']), statement('ATRSAVE', 'table,cell,count,path', ['table', 'cell', 'count', 'path']),
  statement('CHRREAD', 'bank,offset,count', ['bank', 'offset', 'count']), statement('CHRSAVE', 'bank,offset,count,path', ['bank', 'offset', 'count', 'path']),
  statement('PALREAD', 'bank,offset,count', ['bank', 'offset', 'count']), statement('PALSAVE', 'bank,offset,count,path', ['bank', 'offset', 'count', 'path']),
  statement('OAMREAD', 'index,count', ['index', 'count']), statement('OAMSAVE', 'index,count,path', ['index', 'count', 'path']),
  statement('MIALOAD', 'path,address[,maxLength]', ['path', 'address', 'maxLength?']), statement('MIASAVE', 'path,address,length', ['path', 'address', 'length']),
  statement('SEEK#', 'handle,position', ['handle', 'position']), statement('KILL', 'path', ['path']), statement('RMDIR', 'path', ['path']),
  statement('MKDIR', 'path', ['path']), statement('NAME', 'oldPath AS newPath', ['oldPath', 'newPath']), statement('CD', 'path', ['path']),
  statement('DIR', '[path]', ['path?']), statement('INPUTMODE', 'mode', ['mode']), statement('KEYCLEAR', '', []),
  statement('KEYREPEAT', 'delay[,interval]', ['delay', 'interval?']), statement('KEYRPT', 'code,enabled', ['code', 'enabled']),
  statement('MOUSE', 'deltaX,deltaY,buttons,wheel,pan', ['deltaX', 'deltaY', 'buttons', 'wheel', 'pan']), statement('PADREAD', 'pad', ['pad']),
  statement('OVLON', '', []), statement('OVLOFF', '', []), statement('OVLBANK', 'bank', ['bank']), statement('OVLALT', 'bank', ['bank']),
  statement('DELAY', 'milliseconds', ['milliseconds']), statement('MPOKE', 'address,value', ['address', 'value']),
  statement('MCOPY', 'source,destination,length', ['source', 'destination', 'length']), statement('MFILL', 'address,length,value', ['address', 'length', 'value']),
  statement('FLUSH', '#handle', ['handle']), statement('FSTAT', 'path,size,attributes,date,time', ['path', 'size', 'attributes', 'date', 'time']),
  statement('BLOAD', 'path[,run][,address]', ['path', 'run?', 'address?']), statement('BSAVE', 'path,address,length[,bank]', ['path', 'address', 'length', 'bank?']),
  statement('SYS', 'address', ['address']), statement('TRACK', 'voice,music[,address]', ['voice', 'music', 'address?']),
  statement('BAND', 'enabled | voice,enabled', ['voice?', 'enabled']), statement('VTAKE', 'voice', ['voice']), statement('VGIVE', 'voice', ['voice']),
];

export const basicSignatureByKeyword = new Map(basicSignatures.map(signature => [signature.keyword, signature]));
export const basicStatementKeywords = new Set(basicSignatures.filter(signature => signature.kind === 'statement').map(signature => signature.keyword));
export const basicFunctionKeywords = new Set(basicSignatures.filter(signature => signature.kind === 'function').map(signature => signature.keyword));
