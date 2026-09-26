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
export interface PortableAssetSet {
  palettes:PaletteAsset[]; paletteConfigs:PaletteConfigAsset[]; tilesets:TilesetAsset[]; backgrounds:BackgroundAsset[];
  overlays:OverlayAsset[]; shapes:ShapeAsset[]; animations:AnimationAsset[];
}
