import type {ShapeSprite} from "./types.js";
export function spriteAttr(s:Pick<ShapeSprite,"paletteBank"|"flipX"|"flipY">&{priority?:boolean}):number{return(s.paletteBank&15)|(s.priority?16:0)|(s.flipX?32:0)|(s.flipY?64:0)}
export function spriteExt(s:Pick<ShapeSprite,"x"|"y">&{disabled?:boolean}):number{return((s.x>>8)&3)|(((s.y>>8)&1)<<2)|(s.disabled?8:0)}
export function cellAttr(c:{paletteBank:number;flipX:boolean;flipY:boolean;priority?:boolean;chrAlt?:boolean}):number{return(c.paletteBank&15)|(c.flipX?16:0)|(c.flipY?32:0)|(c.priority?64:0)|(c.chrAlt?128:0)}
