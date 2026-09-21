import type {ClementinaProjectManifest} from "./types.js";
const fail=(m:string):never=>{throw new Error(m)};
const pathOk=(p:unknown):p is string=>typeof p==="string"&&p.length>0&&!p.includes("\\")&&!p.startsWith("/")&&!/^[A-Za-z]:/.test(p)&&!p.split("/").some(x=>x===""||x==="."||x==="..");
export function validateProjectManifest(m:ClementinaProjectManifest):void {
 if(!m||typeof m!=="object"||m.format!=="clementina-project"||m.version!==1)fail("Invalid Clementina project manifest");
 if(typeof m.name!=="string"||!m.name.trim()||m.name.length>80)fail("Invalid project name");
 if(!m.target||m.target.machine!=="clementina-6502")fail("Invalid project target");
 if(m.target.phi2Hz!==undefined&&(!Number.isInteger(m.target.phi2Hz)||m.target.phi2Hz<1||m.target.phi2Hz>8000000))fail("PHI2 must be 1..8000000 Hz");
 if(!m.program||!['basic','assembly','mixed'].includes(m.program.kind)||!pathOk(m.program.entry))fail("Invalid program entry");
 if(m.program.sources&&(!Array.isArray(m.program.sources)||m.program.sources.some(p=>!pathOk(p))))fail("Invalid source path");
 if(!m.assets)fail("Project assets are required");
 for(const key of ['palettes','paletteConfigs','tilesets','shapes','animations'] as const){const a=m.assets[key];if(!Array.isArray(a)||a.some(p=>!pathOk(p))||new Set(a).size!==a.length)fail(`Invalid ${key} paths`);}
}
