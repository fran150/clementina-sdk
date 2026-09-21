import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");const dir=path.join(root,"specs"),failures=[];
function read(name){try{return JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"))}catch(e){failures.push(`${name}: ${e.message}`);return null}}
const machine=read('machine.json'),video=read('video.json'),input=read('input.json'),audio=read('audio.json'),storage=read('storage.json'),abi=read('kernel-abi.json'),assets=read('assets.json'),issues=read('known-issues.json');read('mia-registers.json');read('mia-commands.json');read('source-manifest.json');
for(const n of ['machine.schema.json','assets.schema.json','project.schema.json','palette.schema.json','palette-config.schema.json','tileset.schema.json','shape.schema.json','animation.schema.json'])read(`schema/${n}`);
if(machine){if(machine.timing.defaultPhi2Hz!==1200000)failures.push('default PHI2 must be 1.2 MHz');if(machine.memory.baseRam.size!==32768)failures.push('base RAM must be 32 KiB');if(machine.memory.extendedRamWindow.banks!==32)failures.push('extended RAM must have 32 banks');if(machine.miaRam.size!==262144)failures.push('MIA RAM must be 256 KiB')}
if(video){if(video.display.width!==320||video.display.height!==200)failures.push('video must be 320x200');if(video.chr.banks*video.chr.bytesPerBank!==49152)failures.push('CHR size mismatch');if(video.sprites.count*video.sprites.recordBytes!==1280)failures.push('OAM size mismatch');if(video.directOamIndexes?.start!=="$C0"||video.directOamIndexes?.end!=="$DF")failures.push('direct OAM indexes must be $C0-$DF')}
if(input?.stateRegion.size!==128)failures.push('input block must be 128 bytes');if(audio?.voices!==4)failures.push('audio must have four voices');if(audio?.indexes.all!=="$E6"||audio?.indexes.sequencerStatus3!=="$EF")failures.push('audio indexes must occupy $E6-$EF');if(storage?.maxFileHandles!==16)failures.push('storage must expose 16 handles');
if(abi)for(let i=1;i<abi.entries.length;i++)if(abi.entries[i].address-abi.entries[i-1].address!==abi.entrySize){failures.push('kernel ABI entries are not contiguous');break}
if(assets){if(assets.constraints.tilesetBytes!==6144)failures.push('tileset size must be 6144');if(assets.constraints.paletteBanks!==16)failures.push('palette bank count must be 16')}
if(failures.length){console.error('Clementina spec validation failed:');for(const f of failures)console.error(`- ${f}`);process.exit(1)}console.log('Clementina specs: OK');
