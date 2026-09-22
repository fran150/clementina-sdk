export type ProgramKind="basic"|"assembly"|"mixed";
export interface ProjectAssemblyBuild {
 linkerConfig:string;outputName:string;loadAddress:number;bank?:number;entrySymbol:string;
 includeDirectories?:string[];defines?:Record<string,string|number>;
}
export interface ProjectVideoBuild {
 paletteConfigId?:string;tilesets?:Array<{tilesetId:string;bank:number}>;
}
export interface ProjectBuild {
 outputDirectory:string;assembly:ProjectAssemblyBuild;video?:ProjectVideoBuild;
}
export interface ClementinaProjectManifest {
 format:"clementina-project";version:1;name:string;description?:string;
 target:{machine:"clementina-6502";phi2Hz?:number};
 program:{kind:ProgramKind;entry:string;sources?:string[]};
 assets:{palettes:string[];paletteConfigs:string[];tilesets:string[];shapes:string[];animations:string[]};
 build?:ProjectBuild;
}
