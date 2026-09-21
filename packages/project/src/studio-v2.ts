import type {AnimationAsset,PaletteAsset,PaletteConfigAsset,PortableAssetSet,ShapeAsset,TilesetAsset} from "@clementina/assets";
import {validateAssetSet} from "@clementina/assets";

export interface StudioProjectV2 {paletteLibrary:Array<{id:string;name:string;colors:number[]}>;paletteConfigs:Array<{id:string;name:string;banks:Array<string|null>}>;activeConfigId?:string;tilesets:StudioTileset[];shapes:StudioShape[];animations:Array<{name:string;frames:Array<{shapeId:string;ticks:number;dx?:number;dy?:number}>}>}
export interface StudioTileset {id?:string;name:string;bpp:number;chr:number[];previewBackground?:string;tilePaletteBanks:number[];compositions:Array<{name:string;x:number;y:number;width:number;height:number}>}
export interface StudioShape {id:string;name:string;tilesetId?:string;canvasPixelWidth?:number;canvasPixelHeight?:number;canvasWidth?:number;canvasHeight?:number;originAnchor?:string;originX?:number;originY?:number;sprites:Array<{tile:number;x:number;y:number;paletteBank:number;flipX:boolean;flipY:boolean}>}

const slug=(s:string)=>s.trim().replace(/[^A-Za-z0-9._:-]+/g,"-").replace(/^-+|-+$/g,"")||"asset";
function newId(prefix:string,name:string,used:Set<string>):string{let stem=`${prefix}:${slug(name)}`.slice(0,64),id=stem,n=2;while(used.has(id)){const suffix=`-${n++}`;id=stem.slice(0,64-suffix.length)+suffix}used.add(id);return id}

export function fromStudioProjectV2(p:StudioProjectV2):PortableAssetSet {
 const palettes:PaletteAsset[]=p.paletteLibrary.map(x=>({format:"clementina-palette",version:1,id:x.id,name:x.name,colors:[...x.colors]}));
 const paletteConfigs:PaletteConfigAsset[]=p.paletteConfigs.map(x=>({format:"clementina-palette-config",version:1,id:x.id,name:x.name,banks:[...x.banks]}));
 const used=new Set<string>();const oldToNew=new Map<string,string>();
 const tilesets:TilesetAsset[]=p.tilesets.map(t=>{let id=t.id&&t.id.length?t.id:newId("tileset",t.name,used);if(used.has(id)&&t.id)id=newId("tileset",t.name,used);else used.add(id);if(t.id)oldToNew.set(t.id,id);return{format:"clementina-tileset",version:1,id,name:t.name,bpp:t.bpp as 1|3,chr:[...t.chr],authoring:{tilePaletteBanks:[...t.tilePaletteBanks],compositions:t.compositions.map(c=>({...c}))}}});
 const shapes:ShapeAsset[]=p.shapes.map(s=>{let tid=s.tilesetId?oldToNew.get(s.tilesetId):undefined;if(!tid&&p.tilesets.length===1)tid=tilesets[0].id;if(!tid)throw Error(`Shape ${s.name} does not resolve to one tileset`);const o:ShapeAsset={format:"clementina-shape",version:1,id:s.id,name:s.name,tilesetId:tid,sprites:s.sprites.map(x=>({...x}))};const w=s.canvasPixelWidth??(s.canvasWidth!==undefined?s.canvasWidth*8:undefined),h=s.canvasPixelHeight??(s.canvasHeight!==undefined?s.canvasHeight*8:undefined);if(w!==undefined)o.canvasPixelWidth=Math.min(320,w);if(h!==undefined)o.canvasPixelHeight=Math.min(200,h);if(s.originAnchor&&['top-left','center','bottom-center','custom'].includes(s.originAnchor))o.originAnchor=s.originAnchor as ShapeAsset['originAnchor'];if(s.originX!==undefined)o.originX=s.originX;if(s.originY!==undefined)o.originY=s.originY;return o});
 const animIds=new Set<string>();const animations:AnimationAsset[]=p.animations.map(a=>({format:"clementina-animation",version:1,id:newId("animation",a.name,animIds),name:a.name,frames:a.frames.map(f=>({...f}))}));
 const result={palettes,paletteConfigs,tilesets,shapes,animations};validateAssetSet(result);return result;
}

export function toStudioProjectV2(a:PortableAssetSet):StudioProjectV2 {
 validateAssetSet(a);return{paletteLibrary:a.palettes.map(({id,name,colors})=>({id,name,colors:[...colors]})),paletteConfigs:a.paletteConfigs.map(({id,name,banks})=>({id,name,banks:[...banks]})),activeConfigId:a.paletteConfigs[0]?.id,tilesets:a.tilesets.map(t=>({id:t.id,name:t.name,bpp:t.bpp,chr:[...t.chr],tilePaletteBanks:[...t.authoring.tilePaletteBanks],compositions:t.authoring.compositions.map(c=>({...c}))})),shapes:a.shapes.map(s=>({id:s.id,name:s.name,tilesetId:s.tilesetId,canvasPixelWidth:s.canvasPixelWidth,canvasPixelHeight:s.canvasPixelHeight,originAnchor:s.originAnchor,originX:s.originX,originY:s.originY,sprites:s.sprites.map(x=>({...x}))})),animations:a.animations.map(x=>({name:x.name,frames:x.frames.map(f=>({...f}))}))};
}
