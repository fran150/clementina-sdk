export type ProgramKind="basic"|"assembly"|"mixed";
export interface ClementinaProjectManifest {
 format:"clementina-project";version:1;name:string;description?:string;
 target:{machine:"clementina-6502";phi2Hz?:number};
 program:{kind:ProgramKind;entry:string;sources?:string[]};
 assets:{palettes:string[];paletteConfigs:string[];tilesets:string[];shapes:string[];animations:string[]};
}
