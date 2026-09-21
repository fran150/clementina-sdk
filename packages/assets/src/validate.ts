import type {AnimationAsset,PaletteAsset,PaletteConfigAsset,PortableAssetSet,ShapeAsset,TilesetAsset} from "./types.js";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TILESET=/^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const ASM=/^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const int=(v:unknown,min:number,max:number)=>Number.isInteger(v)&&Number(v)>=min&&Number(v)<=max;
const fail=(m:string):never=>{throw new Error(m)};

export function validatePalette(a:PaletteAsset):void {
 if(!isObj(a)||a.format!=="clementina-palette"||a.version!==1||!ID.test(a.id)||typeof a.name!=="string"||!a.name.trim())fail("Invalid palette");
 if(!Array.isArray(a.colors)||a.colors.length!==8||a.colors.some(v=>!int(v,0,65535)))fail("Palettes hold exactly eight RGB565 colors");
}
export function validatePaletteConfig(a:PaletteConfigAsset,paletteIds?:Set<string>):void {
 if(!isObj(a)||a.format!=="clementina-palette-config"||a.version!==1||!ID.test(a.id)||typeof a.name!=="string"||!a.name.trim())fail("Invalid palette config");
 if(!Array.isArray(a.banks)||a.banks.length!==16)fail("A palette config has exactly sixteen banks");
 for(const id of a.banks)if(id!==null&&(!ID.test(id)||(paletteIds&&!paletteIds.has(id))))fail("Palette config references an unknown palette");
}
export function validateTileset(a:TilesetAsset):void {
 if(!isObj(a)||a.format!=="clementina-tileset"||a.version!==1||!ID.test(a.id)||!TILESET.test(a.name)||![1,3].includes(a.bpp))fail("Invalid tileset");
 if(!Array.isArray(a.chr)||a.chr.length!==6144||a.chr.some(v=>!int(v,0,255)))fail("A tileset contains exactly 6144 CHR bytes");
 if(!isObj(a.authoring)||!Array.isArray(a.authoring.tilePaletteBanks)||a.authoring.tilePaletteBanks.length!==256||a.authoring.tilePaletteBanks.some(v=>!int(v,0,15)))fail("A tileset has 256 palette-bank hints");
 if(!Array.isArray(a.authoring.compositions))fail("Invalid compositions");
 const names=new Set<string>();
 for(const c of a.authoring.compositions){
  if(!isObj(c)||typeof c.name!=="string"||!c.name.trim()||names.has(c.name))fail("Composition names must be unique and non-empty");names.add(c.name);
  if(!int(c.x,0,15)||!int(c.y,0,15)||!int(c.width,1,16-Number(c.x))||!int(c.height,1,16-Number(c.y)))fail("Composition lies outside the tileset");
 }
}
export function validateShape(a:ShapeAsset,tilesetIds?:Set<string>):void {
 if(!isObj(a)||a.format!=="clementina-shape"||a.version!==1||!ID.test(a.id)||!ASM.test(a.name)||!ID.test(a.tilesetId))fail("Invalid shape");
 if(tilesetIds&&!tilesetIds.has(a.tilesetId))fail("Shape references an unknown tileset");
 if(a.canvasPixelWidth!==undefined&&!int(a.canvasPixelWidth,1,320))fail("Invalid shape canvas width");
 if(a.canvasPixelHeight!==undefined&&!int(a.canvasPixelHeight,1,200))fail("Invalid shape canvas height");
 if(a.originAnchor!==undefined&&!['top-left','center','bottom-center','custom'].includes(a.originAnchor))fail("Invalid origin anchor");
 if(a.originX!==undefined&&!int(a.originX,-32768,32767))fail("Invalid origin X");
 if(a.originY!==undefined&&!int(a.originY,-32768,32767))fail("Invalid origin Y");
 if(!Array.isArray(a.sprites)||a.sprites.length>64)fail("A shape holds at most 64 sprites");
 for(const s of a.sprites)if(!isObj(s)||!int(s.tile,0,255)||!int(s.x,-512,511)||!int(s.y,-256,255)||!int(s.paletteBank,0,15)||typeof s.flipX!=="boolean"||typeof s.flipY!=="boolean")fail("Invalid shape sprite");
}
export function validateAnimation(a:AnimationAsset,shapes?:Map<string,ShapeAsset>):void {
 if(!isObj(a)||a.format!=="clementina-animation"||a.version!==1||!ID.test(a.id)||!ASM.test(a.name))fail("Invalid animation");
 if(!Array.isArray(a.frames)||a.frames.length<1||a.frames.length>255)fail("An animation has 1 to 255 frames");
 const tilesets=new Set<string>();
 for(const f of a.frames){
  if(!isObj(f)||!ID.test(f.shapeId)||!int(f.ticks,1,255))fail("Invalid animation frame");
  if(f.dx!==undefined&&!int(f.dx,-512,511)||f.dy!==undefined&&!int(f.dy,-512,511))fail("Invalid animation frame offset");
  if(shapes){const s=shapes.get(f.shapeId);if(!s){fail(`Animation ${a.name} references unknown shape ${f.shapeId}`);continue;}tilesets.add(s.tilesetId);}
 }
 if(tilesets.size>1)fail(`Every shape in ${a.name} must use the same tileset`);
}
function uniqueCI(values:string[],what:string):void {const s=new Set<string>();for(const v of values){const k=v.toLowerCase();if(s.has(k))fail(`${what} must be unique`);s.add(k)}}
export function validateAssetSet(set:PortableAssetSet):void {
 if(!isObj(set))fail("Invalid asset set");
 if(set.shapes.length>255)fail("At most 255 shapes are supported"); if(set.animations.length>255)fail("At most 255 animations are supported");
 set.palettes.forEach(validatePalette);const pids=new Set(set.palettes.map(x=>x.id));if(pids.size!==set.palettes.length)fail("Palette ids must be unique");uniqueCI(set.palettes.map(x=>x.name),"Palette names");
 set.paletteConfigs.forEach(x=>validatePaletteConfig(x,pids));const cids=new Set(set.paletteConfigs.map(x=>x.id));if(cids.size!==set.paletteConfigs.length)fail("Palette config ids must be unique");uniqueCI(set.paletteConfigs.map(x=>x.name),"Palette config names");
 set.tilesets.forEach(validateTileset);const tids=new Set(set.tilesets.map(x=>x.id));if(tids.size!==set.tilesets.length)fail("Tileset ids must be unique");uniqueCI(set.tilesets.map(x=>x.name),"Tileset names");
 set.shapes.forEach(x=>validateShape(x,tids));const shapes=new Map(set.shapes.map(x=>[x.id,x]));if(shapes.size!==set.shapes.length)fail("Shape ids must be unique");uniqueCI(set.shapes.map(x=>x.name),"Shape names");
 set.animations.forEach(x=>validateAnimation(x,shapes));const aids=new Set(set.animations.map(x=>x.id));if(aids.size!==set.animations.length)fail("Animation ids must be unique");uniqueCI(set.animations.map(x=>x.name),"Animation names");
}
