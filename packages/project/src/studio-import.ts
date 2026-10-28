import type {PortableAssetSet} from "@clementina/assets";
import {fromStudioProjectV2, type StudioProjectV2} from "./studio-v2.js";
import {validateStudioProject} from "./studio-validation.js";
import type {ClementinaProjectManifest, ProjectAssetsBuild} from "./types.js";
import type {PortableProject} from "./project.js";

/** A new assembly project's program loads here and may use RAM up to $8000. */
export const ASSEMBLY_STARTER_LOAD_ADDRESS = 0x1800;

/** A new assembly project's src/main.s: an empty game loop that includes the built assets. */
export const ASSEMBLY_STARTER_MAIN = `.setcpu "65C02"
.include "assets.inc"
.export game_start
.segment "CODE"
game_start:
 ; Add Load, DrawScreen and the other runtime calls here.
 jmp game_start
`;

/** A new assembly project's link.cfg: zero page below the system's $E0-$FF, then the program and its data in RAM. */
export const ASSEMBLY_STARTER_LINK_CFG = `MEMORY { ZP: start=$40, size=$A0, type=rw; RAM: start=$1800, size=$6800, type=rw, file=%O; }
SEGMENTS { ZEROPAGE: load=ZP, type=zp; CODE: load=RAM, type=ro; RODATA: load=RAM, type=ro; DATA: load=RAM, type=rw; BSS: load=RAM, type=bss, define=yes; }
`;

/** A Studio v2 session file: the editable project plus Studio-only state such as Builder settings. */
export type StudioSessionV2 = StudioProjectV2 & {format?: string; version?: number; builder?: ProjectAssetsBuild};

const KIND_FOLDERS: Record<keyof PortableAssetSet, string> = {
 palettes: "palettes", paletteConfigs: "palette-configs", tilesets: "tilesets", backgrounds: "backgrounds",
 overlays: "overlays", shapes: "shapes", animations: "animations", instruments: "instruments", sounds: "sounds", songs: "songs",
};

/** A file name from an asset name: letters, digits, dot, dash and underscore. */
function fileStem(name: string): string {
 return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 48) || "asset";
}

/**
 * The portable assembly project for a Studio v2 session: every asset in its
 * own JSON file named after the asset (`assets/<kind>/<name>.json`), and the
 * session's Builder settings, if any, as `build.assets`. Throws when the
 * session is invalid. Writes nothing.
 */
export function importStudioProject(session: StudioSessionV2, name: string): PortableProject {
 if (session.format !== undefined && session.format !== "clementina-studio") throw Error(`Not a Clementina Studio project: format ${session.format}`);
 if (session.version !== undefined && session.version !== 2) throw Error(`Unsupported Clementina Studio project version ${session.version}`);
 validateStudioProject(session);
 const assets = fromStudioProjectV2(session);
 const manifest: ClementinaProjectManifest = {
  format: "clementina-project", version: 1, name: name.trim() || "Game",
  target: {machine: "clementina-6502"},
  program: {kind: "assembly", entry: "src/main.s"},
  assets: {palettes: [], paletteConfigs: [], tilesets: [], backgrounds: [], overlays: [], shapes: [], animations: [], instruments: [], sounds: [], songs: []},
  build: {
   outputDirectory: "build",
   assembly: {linkerConfig: "link.cfg", outputName: "game", loadAddress: ASSEMBLY_STARTER_LOAD_ADDRESS, entrySymbol: "game_start"},
   ...(session.builder ? {assets: structuredClone(session.builder)} : {}),
  },
 };
 for (const kind of Object.keys(KIND_FOLDERS) as Array<keyof PortableAssetSet>) {
  const used = new Set<string>();
  manifest.assets[kind] = (assets[kind] as Array<{name: string}>).map(asset => {
   const stem = fileStem(asset.name);
   let path = `assets/${KIND_FOLDERS[kind]}/${stem}.json`;
   for (let n = 2; used.has(path.toLowerCase()); n++) path = `assets/${KIND_FOLDERS[kind]}/${stem}-${n}.json`;
   used.add(path.toLowerCase());
   return path;
  });
 }
 return {manifest, assets};
}
