export const PORTABLE_ASSET_VERSION = 1 as const;
export type TilesetBpp = 1 | 3;
export type OriginAnchor = "top-left" | "center" | "bottom-center" | "custom";

export interface PaletteAsset {
  format: "clementina-palette"; version: 1; id: string; name: string; colors: number[];
}
export interface PaletteConfigAsset {
  format: "clementina-palette-config"; version: 1; id: string; name: string; banks: Array<string|null>;
}
export interface TilesetComposition { name:string; x:number; y:number; width:number; height:number }
export interface TilesetAsset {
  format: "clementina-tileset"; version: 1; id:string; name:string; bpp:TilesetBpp; chr:number[];
  authoring:{ tilePaletteBanks:number[]; compositions:TilesetComposition[] };
}
export interface ShapeSprite { tile:number; x:number; y:number; paletteBank:number; flipX:boolean; flipY:boolean }
export interface ShapeAsset {
  format:"clementina-shape"; version:1; id:string; name:string; tilesetId:string;
  canvasPixelWidth?:number; canvasPixelHeight?:number; originAnchor?:OriginAnchor; originX?:number; originY?:number;
  sprites:ShapeSprite[];
}
export interface AnimationFrame { shapeId:string; ticks:number; dx?:number; dy?:number; flipX?:boolean; flipY?:boolean }
export interface AnimationAsset {
  format:"clementina-animation"; version:1; id:string; name:string; frames:AnimationFrame[];
}
export interface BackgroundCell { tile:number; paletteBank:number; flipX:boolean; flipY:boolean; priority:boolean; chrAlt:boolean }
export interface BackgroundAsset {
  format:"clementina-background"; version:1; id:string; name:string; width:number; height:number;
  tilesetId:string; altTilesetId:string; cells:BackgroundCell[];
}
export type OverlayCell = BackgroundCell;
export interface OverlayPlaceholder { id:string; name:string; col:number; row:number; width:number; height:number }
export interface OverlayAsset {
  format:"clementina-overlay"; version:1; id:string; name:string;
  tilesetId:string; altTilesetId:string; cells:OverlayCell[]; placeholders:OverlayPlaceholder[];
}
/** What a song's SET_* opcodes put on a voice between notes. */
export interface InstrumentAsset {
  format:"clementina-instrument"; version:1; id:string; name:string;
  wave:number; pulse:number; attack:number; decay:number; sustain:number; release:number; volume:number;
}
/** One 60 Hz frame of a sound effect: what the driver writes to its voice that frame. */
export interface SoundFrame { freq:number; volume:number; pulse:number; wave:number; gate:boolean }
export interface SoundAsset {
  format:"clementina-sound"; version:1; id:string; name:string;
  attack:number; decay:number; sustain:number; release:number; pan:number; frames:SoundFrame[];
}
/** A semitone (0 = C0) held from `step` for `length` steps. */
export interface SongNote { step:number; length:number; pitch:number; instrumentId:string; legato?:boolean }
export interface SongVoice { pan:number; notes:SongNote[] }
/** Four voices on a step grid; `loopStart` is where the song jumps back to at its end. */
export interface SongAsset {
  format:"clementina-song"; version:1; id:string; name:string;
  bpm:number; stepsPerBeat:1|2|3|4|6|8; beatsPerBar:number; length:number; loopStart?:number; voices:SongVoice[];
}
export interface PortableAssetSet {
  palettes:PaletteAsset[]; paletteConfigs:PaletteConfigAsset[]; tilesets:TilesetAsset[]; backgrounds:BackgroundAsset[];
  overlays:OverlayAsset[]; shapes:ShapeAsset[]; animations:AnimationAsset[];
  instruments:InstrumentAsset[]; sounds:SoundAsset[]; songs:SongAsset[];
}
