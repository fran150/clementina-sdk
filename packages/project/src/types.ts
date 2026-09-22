export type ProgramKind="basic"|"assembly"|"mixed";
export interface ProjectAssemblyBuild {
 linkerConfig:string;outputName:string;loadAddress:number;bank?:number;entrySymbol:string;
 includeDirectories?:string[];defines?:Record<string,string|number>;
}
export interface ProjectBasicBuild {outputName:string}
export interface ProjectVideoBuild {
 paletteConfigId?:string;tilesets?:Array<{tilesetId:string;bank:number}>;
}
export type ProjectBuild = {outputDirectory:string;video?:ProjectVideoBuild}&(
 {assembly:ProjectAssemblyBuild;basic?:ProjectBasicBuild}|{basic:ProjectBasicBuild;assembly?:ProjectAssemblyBuild}
);
export interface ClementinaProjectManifest {
 format:"clementina-project";version:1;name:string;description?:string;
 target:{machine:"clementina-6502";phi2Hz?:number};
 program:{kind:ProgramKind;entry:string;sources?:string[]};
 assets:{palettes:string[];paletteConfigs:string[];tilesets:string[];shapes:string[];animations:string[]};
 build?:ProjectBuild;
}
