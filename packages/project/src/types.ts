/**
 * An address or size. The checked manifest holds numbers; clementina.yaml may
 * also write hex strings (`$7000`, `0x7000`), which checking turns into numbers.
 */
export type ManifestAddress = number | string;
export interface ProjectAssemblyBuild<A = number> {
 /** ca65 sources, assembled and linked into one PRG. */
 sources:string[];linkerConfig:string;outputName:string;loadAddress:A;bank?:number;entrySymbol:string;
 includeDirectories?:string[];defines?:Record<string,string|number>;
 /** Assemble the Clementina library with its argument checks (CL_CHECKS); default true. */
 checks?:boolean;
 /** More code linked at $8000-$BFFF: each ld65 MEMORY area here becomes its own PRG, loaded with BANK n:BLOAD. */
 banks?:ProjectAssemblyBank[];
}
/** One bank of code: the extended RAM bank (1-31) and the ld65 MEMORY area it holds. */
export interface ProjectAssemblyBank {bank:number;memory:string}
export interface ProjectBasicBuild<A = number> {
 outputName:string;
 /** MEMSIZ to set before the program runs: BASIC keeps bank-0 RAM from here to $BFFF free. */
 memoryTop?:A;
}
export interface ProjectVideoBuild {
 paletteConfigId?:string;tilesets?:Array<{tilesetId:string;bank:number}>;
}
/**
 * A named range assets load into: MIA RAM (`mia`) or CPU banks (`bank` and an
 * `address` in the $8000-$BFFF window, running on into the next banks).
 */
export interface ProjectAssetSlot<A = number> {name:string;size:A;mia?:A;bank?:number;address?:A}
export type ProjectAssetBuildKind="paletteConfig"|"tileset"|"background"|"overlay"|"sprites"|"song"|"sound";
/** An asset the build writes to the card. A sprite file names its tileset's id. */
export interface ProjectAssetInclude {kind:ProjectAssetBuildKind;id:string;slot:string;file?:string}
export interface ProjectAssetsBuild<A = number> {folder?:string;slots:ProjectAssetSlot<A>[];include:ProjectAssetInclude[]}
/** Settings for each part the project has: `assembly`, `basic` for program.entry, or both. */
export type ProjectBuild<A = number> = {outputDirectory:string;video?:ProjectVideoBuild;assets?:ProjectAssetsBuild<A>}&(
 {assembly:ProjectAssemblyBuild<A>;basic?:ProjectBasicBuild<A>}|{basic:ProjectBasicBuild<A>;assembly?:ProjectAssemblyBuild<A>}
);
/** A project manifest. `ClementinaProjectManifest<ManifestAddress>` is clementina.yaml as written. */
export interface ClementinaProjectManifest<A = number> {
 format:"clementina-project";version:1;name:string;description?:string;
 target:{machine:"clementina-6502";phi2Hz?:number};
 /** The BASIC program that runs last. Without one, the generated loader BRUNs build.assembly. */
 program?:{entry:string};
 assets:{palettes:string[];paletteConfigs:string[];tilesets:string[];backgrounds:string[];overlays:string[];shapes:string[];animations:string[];instruments?:string[];sounds?:string[];songs?:string[]};
 build?:ProjectBuild<A>;
}
/** A kind's asset paths; the audio kinds may be left out of a manifest. */
export function assetPaths(manifest:Pick<ClementinaProjectManifest,"assets">,kind:keyof ClementinaProjectManifest["assets"]):string[]{return manifest.assets[kind]??[]}
/** Every source file the project compiles: the BASIC entry, then the assembly sources. */
export function programSources(manifest:Pick<ClementinaProjectManifest,"program"|"build">):string[]{
 return [...(manifest.program?[manifest.program.entry]:[]),...(manifest.build?.assembly?.sources??[])];
}
