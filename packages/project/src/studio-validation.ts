import {diagnostic, errorMessage, result, type ValidationResult} from '@clementina/core';
import {validateStudioInstruments, validateStudioSounds, validateStudioSongs} from '@clementina/assets/audio';
import type {StudioProjectV2, StudioTileset, StudioShape, StudioBackground, StudioOverlay} from './studio-v2.js';

// Studio v2 is a session format. These compatibility checks retain its accepted
// input surface; portable assets are checked separately by @clementina/assets.
// Values are mirrored from specs/assets.json and specs/schema/.
type StudioProject = StudioProjectV2;
type ProjectPalette = StudioProject['paletteLibrary'][number];
type PaletteBankConfig = StudioProject['paletteConfigs'][number];
type Tileset = StudioTileset;
type Background = StudioBackground;
type Overlay = StudioOverlay;
type Shape = StudioShape;
type Animation = StudioProject['animations'][number];
const PALETTE_COLORS = 8, PALETTE_BANKS = 16, BANK_BYTES = 6144, TILES_PER_BANK = 256;
const MAX_BACKGROUND_DIMENSION = 1024, MAX_BACKGROUND_CELLS = 200000;
const OVERLAY_COLUMNS = 40, OVERLAY_ROWS = 25, OVERLAY_CELLS = 1000;

function integers(a: unknown, length: number, max: number): a is number[] {
 return Array.isArray(a) && a.length === length && a.every(v => Number.isInteger(v) && v >= 0 && v <= max);
}
function range(n:unknown,min:number,max:number):boolean {return Number.isInteger(n) && Number(n)>=min && Number(n)<=max;}

export function validateStudioProject(p: StudioProject): void {
 if(!p||typeof p!=='object')throw Error('Invalid Studio project');
 const normalized=normalizeStudioProjectV2(p);
 validateStudioPaletteLibrary(normalized.paletteLibrary);
 validateStudioPaletteConfigs(normalized.paletteConfigs,normalized.paletteLibrary);
 if(normalized.activeConfigId!==undefined&&!normalized.paletteConfigs.some(c=>c.id===normalized.activeConfigId))throw Error('The active config is not in the project');
 validateStudioTilesets(normalized.tilesets);
 validateStudioBackgrounds(normalized.backgrounds,normalized.tilesets);
 validateStudioOverlays(normalized.overlays,normalized.tilesets);
 validateStudioShapes(normalized.shapes,normalized.tilesets);
 validateStudioAnimations(normalized.animations,normalized.shapes);
 validateStudioInstruments(normalized.instruments??[]);
 validateStudioSounds(normalized.sounds??[]);
 validateStudioSongs(normalized.songs??[],normalized.instruments??[]);
}

export function validateStudioPaletteLibrary(library:ProjectPalette[]):void {
 if(!Array.isArray(library))throw Error('Invalid palette library');
 const ids=new Set<string>(),names=new Set<string>();
 for(const p of library){
  if(!p||typeof p.id!=='string'||!p.id.length||ids.has(p.id))throw Error('Palette identities must be unique');
  ids.add(p.id);
  if(typeof p.name!=='string'||!p.name.trim()||names.has(p.name.toLowerCase()))throw Error('Palette names must be unique and non-empty');
  names.add(p.name.toLowerCase());
  if(!integers(p.colors,PALETTE_COLORS,65535))throw Error('Palettes hold exactly eight RGB565 colors');
 }
}

export function validateStudioPaletteConfigs(configs:PaletteBankConfig[],library:ProjectPalette[]=[]):void {
 if(!Array.isArray(configs))throw Error('Invalid palette bank configs');
 const paletteIds=new Set(library.map(p=>p.id));
 const ids=new Set<string>(),names=new Set<string>();
 for(const c of configs){
  if(!c||typeof c.id!=='string'||!c.id.length||ids.has(c.id))throw Error('Config identities must be unique');
  ids.add(c.id);
  if(typeof c.name!=='string'||!c.name.trim()||names.has(c.name.toLowerCase()))throw Error('Config names must be unique and non-empty');
  names.add(c.name.toLowerCase());
  // A bank may hold nothing, and two banks may hold the same palette: banks are
  // an authored layout, not a set.
  if(!Array.isArray(c.banks)||c.banks.length!==PALETTE_BANKS||c.banks.some(b=>b!==null&&!paletteIds.has(b)))
   throw Error('A config names a palette, or nothing, for each of the sixteen palette banks');
 }
}

export function validateStudioTilesets(tilesets:Tileset[]):void {
 if(!Array.isArray(tilesets))throw Error('Invalid tileset library');
 const names=new Set<string>(),ids=new Set<string>();
 for(const t of tilesets){
  if(!t||typeof t.name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(t.name)||names.has(t.name.toLowerCase()))throw Error('Tileset names must be unique file names: letters, digits, underscores, hyphens');
  names.add(t.name.toLowerCase());
  if(t.id!==undefined){if(typeof t.id!=='string'||!t.id.length||ids.has(t.id))throw Error('Invalid tileset identity');ids.add(t.id);}
  if(t.previewBackground!==undefined&&!/^#[0-9a-f]{6}$/i.test(t.previewBackground))throw Error('Invalid preview background');
  if(![1,3].includes(t.bpp))throw Error('A tileset is 1bpp or 3bpp');
  // tilePaletteBanks are absolute palette bank numbers, meaningful under
  // whichever config is loaded, so 0-15 is the whole constraint.
  if(!integers(t.chr,BANK_BYTES,255)||!integers(t.tilePaletteBanks,TILES_PER_BANK,PALETTE_BANKS-1)||!Array.isArray(t.compositions))throw Error('Invalid tileset data');
  const cn=new Set<string>();
  for(const c of t.compositions){if(!c||typeof c.name!=='string'||!c.name.trim()||cn.has(c.name)||!range(c.x,0,15)||!range(c.y,0,15)||!range(c.width,1,16-c.x)||!range(c.height,1,16-c.y))throw Error('Invalid composition');cn.add(c.name);}
 }
}

export function validateStudioBackgrounds(backgrounds:Background[],tilesets:Tileset[]=[]):void {
 if(!Array.isArray(backgrounds)||backgrounds.length>255)throw Error('At most 255 backgrounds are supported');
 const tilesetIds=new Set(tilesets.map(t=>t.id).filter(Boolean) as string[]);
 const names=new Set<string>(),ids=new Set<string>();
 for(const background of backgrounds){
  if(!background||typeof background.name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(background.name)||names.has(background.name.toLowerCase()))throw Error('Background names must be unique file names: letters, digits, underscores, hyphens');
  names.add(background.name.toLowerCase());
  if(typeof background.id!=='string'||!background.id.length||ids.has(background.id))throw Error('Background identities must be unique');
  ids.add(background.id);
  if(!range(background.width,1,MAX_BACKGROUND_DIMENSION)||!range(background.height,1,MAX_BACKGROUND_DIMENSION))throw Error(`A background is 1 to ${MAX_BACKGROUND_DIMENSION} tiles per side`);
  if(background.width*background.height>MAX_BACKGROUND_CELLS)throw Error(`A background holds at most ${MAX_BACKGROUND_CELLS} cells`);
  // A background reads two CHR banks at once, chosen per cell by the CHR_ALT
  // attribute bit — see docs/model.md.
  if(!tilesetIds.has(background.tilesetId))throw Error('A background names a primary tileset in the project');
  if(!tilesetIds.has(background.altTilesetId))throw Error('A background names an alternate tileset in the project');
  if(!Array.isArray(background.cells)||background.cells.length!==background.width*background.height)throw Error('A background holds exactly width × height cells');
  for(const cell of background.cells){
   if(!cell||!range(cell.tile,0,TILES_PER_BANK-1)||!range(cell.paletteBank,0,PALETTE_BANKS-1))throw Error('Invalid background cell');
   if(typeof cell.flipX!=='boolean'||typeof cell.flipY!=='boolean'||typeof cell.priority!=='boolean'||typeof cell.chrAlt!=='boolean')throw Error('Invalid background cell');
  }
 }
}

export function validateStudioOverlays(overlays:Overlay[],tilesets:Tileset[]=[]):void {
 if(!Array.isArray(overlays)||overlays.length>255)throw Error('At most 255 overlays are supported');
 const tilesetIds=new Set(tilesets.map(t=>t.id).filter(Boolean) as string[]);
 const names=new Set<string>(),ids=new Set<string>();
 for(const overlay of overlays){
  if(!overlay||typeof overlay.name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(overlay.name)||names.has(overlay.name.toLowerCase()))throw Error('Overlay names must be unique file names: letters, digits, underscores, hyphens');
  names.add(overlay.name.toLowerCase());
  if(typeof overlay.id!=='string'||!overlay.id.length||ids.has(overlay.id))throw Error('Overlay identities must be unique');
  ids.add(overlay.id);
  // The overlay is the fixed 40 x 25 hardware layer — see docs/model.md.
  if(!tilesetIds.has(overlay.tilesetId))throw Error('An overlay names a primary tileset in the project');
  if(!tilesetIds.has(overlay.altTilesetId))throw Error('An overlay names an alternate tileset in the project');
  if(!Array.isArray(overlay.cells)||overlay.cells.length!==OVERLAY_CELLS)throw Error(`An overlay holds exactly ${OVERLAY_CELLS} cells (${OVERLAY_COLUMNS} x ${OVERLAY_ROWS})`);
  for(const cell of overlay.cells){
   if(!cell||!range(cell.tile,0,TILES_PER_BANK-1)||!range(cell.paletteBank,0,PALETTE_BANKS-1))throw Error('Invalid overlay cell');
   if(typeof cell.flipX!=='boolean'||typeof cell.flipY!=='boolean'||typeof cell.priority!=='boolean'||typeof cell.chrAlt!=='boolean')throw Error('Invalid overlay cell');
  }
  if(!Array.isArray(overlay.placeholders))throw Error('Invalid overlay placeholders');
  const phNames=new Set<string>(),phIds=new Set<string>();
  for(const p of overlay.placeholders){
   if(!p||typeof p.name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(p.name)||phNames.has(p.name.toLowerCase()))throw Error('Placeholder names must be unique file names: letters, digits, underscores, hyphens');
   phNames.add(p.name.toLowerCase());
   if(typeof p.id!=='string'||!p.id.length||phIds.has(p.id))throw Error('Placeholder identities must be unique');
   phIds.add(p.id);
   if(!range(p.col,0,OVERLAY_COLUMNS-1)||!range(p.row,0,OVERLAY_ROWS-1)||!range(p.width,1,OVERLAY_COLUMNS)||!range(p.height,1,OVERLAY_ROWS))throw Error('Invalid placeholder geometry');
   if(p.col+p.width>OVERLAY_COLUMNS||p.row+p.height>OVERLAY_ROWS)throw Error(`Placeholder "${p.name}" lies outside the ${OVERLAY_COLUMNS} x ${OVERLAY_ROWS} overlay grid`);
  }
  for(let i=0;i<overlay.placeholders.length;i++)for(let j=i+1;j<overlay.placeholders.length;j++){
   const a=overlay.placeholders[i],b=overlay.placeholders[j];
   if(a.col<b.col+b.width&&b.col<a.col+a.width&&a.row<b.row+b.height&&b.row<a.row+a.height)throw Error(`Placeholder "${b.name}" overlaps "${a.name}"`);
  }
 }
}
export function validateStudioShapes(shapes:Shape[],tilesets:Tileset[]=[]):void {
 if(!Array.isArray(shapes)||shapes.length>255)throw Error('At most 255 shapes are supported');
 const tilesetIds=new Set(tilesets.map(t=>t.id).filter(Boolean) as string[]);
 const names=new Set<string>(),ids=new Set<string>();
 for(const shape of shapes){
  if(!shape||typeof shape.name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(shape.name)||names.has(shape.name.toUpperCase()))throw Error('Shape names must be unique assembly identifiers (1–32 characters)');
  names.add(shape.name.toUpperCase());
  // Animations name shapes, so a shape needs an identity of its own.
  if(typeof shape.id!=='string'||!shape.id.length||ids.has(shape.id))throw Error('Shape identities must be unique');
  ids.add(shape.id);
  // Sprites all read one CHR bank, so a shape draws from exactly one tileset.
  if(shape.tilesetId!==undefined&&!tilesetIds.has(shape.tilesetId))throw Error('A shape draws from one tileset in the project');
  for(const k of ['canvasWidth','canvasHeight'] as const)if(shape[k]!==undefined&&!range(shape[k],1,128))throw Error('Invalid shape canvas size');
  for(const k of ['originX','originY'] as const)if(shape[k]!==undefined&&!range(shape[k],-32768,32767))throw Error('Invalid shape origin');
  if(shape.canvasPixelWidth!==undefined&&!range(shape.canvasPixelWidth,1,320)||shape.canvasPixelHeight!==undefined&&!range(shape.canvasPixelHeight,1,200))throw Error('Invalid shape canvas pixel dimensions');
  if(shape.originAnchor!==undefined&&!['top-left','center','bottom-center','custom'].includes(shape.originAnchor))throw Error('Invalid shape origin anchor');
  if(!Array.isArray(shape.sprites)||shape.sprites.length>64)throw Error('A shape holds at most 64 sprites');
  for(const sprite of shape.sprites){
   // X is 10-bit signed and Y 9-bit signed in OAM; the high bits live in ext.
   if(!sprite||!range(sprite.tile,0,TILES_PER_BANK-1)||!range(sprite.x,-512,511)||!range(sprite.y,-256,255)||typeof sprite.flipX!=='boolean'||typeof sprite.flipY!=='boolean')throw Error('Invalid sprite');
   if(!range(sprite.paletteBank,0,PALETTE_BANKS-1))throw Error('A sprite names a palette bank 0-15');
  }
 }
}

export function validateStudioAnimations(animations:Animation[],shapes:Shape[]=[]):void {
 if(!Array.isArray(animations)||animations.length>255)throw Error('At most 255 animations are supported');
 const byId=new Map(shapes.map(s=>[s.id,s]));
 const names=new Set<string>(),ids=new Set<string>();
 for(const animation of animations){
  if(!animation||typeof animation.name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(animation.name)||names.has(animation.name.toUpperCase()))throw Error('Animation names must be unique assembly identifiers (1–32 characters)');
  names.add(animation.name.toUpperCase());
  if(animation.id!==undefined){if(typeof animation.id!=='string'||!animation.id.length||ids.has(animation.id))throw Error('Animation identities must be unique');ids.add(animation.id);}
  if(!Array.isArray(animation.frames)||animation.frames.length<1||animation.frames.length>255)throw Error('An animation holds 1 to 255 frames');
  for(const frame of animation.frames){
   if(!frame||!byId.has(frame.shapeId))throw Error('Every animation frame names a shape in the project');
   if(!range(frame.ticks,1,255))throw Error('Animation frames run for 1 to 255 ticks');
   for(const k of ['dx','dy'] as const)if(frame[k]!==undefined&&!range(frame[k],-512,511))throw Error('Invalid animation frame offset');
   for(const k of ['flipX','flipY'] as const)if(frame[k]!==undefined&&typeof frame[k]!=='boolean')throw Error('Invalid animation frame flip');
  }
  // The frames play in sequence out of the one sprite CHR bank, so they cannot
  // come from different tilesets without rewriting SPRBANK mid-animation.
  const tilesets=new Set(animation.frames.map(f=>byId.get(f.shapeId)!.tilesetId));
  if(tilesets.size>1)throw Error(`Every shape in "${animation.name}" must draw from the same tileset`);
 }
}


/** Fill absent v2 collections without changing the caller's session data. */
export function normalizeStudioProjectV2(p: StudioProjectV2): StudioProjectV2 {
 return {...p, backgrounds:p.backgrounds??[], overlays:p.overlays??[], shapes:p.shapes??[], animations:p.animations??[], instruments:p.instruments??[], sounds:p.sounds??[], songs:p.songs??[]};
}

/** Validate a Studio v2 session with its legacy compatibility rules. */
export function checkStudioProjectV2(value: unknown): ValidationResult<StudioProjectV2> {
 try {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Studio project');
  const p = value as StudioProjectV2;
  validateStudioProject(p);
  return result(normalizeStudioProjectV2(p), []);
 } catch (error) {
  return result(undefined, [diagnostic('studio.v2', '', errorMessage(error))]);
 }
}
