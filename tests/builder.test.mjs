import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkProject, checkProjectManifest} from '../packages/project/dist/index.js';
import {saveProject} from '../packages/project/dist/node.js';
import {planAssetBuild, buildProject, runtimeCodeSize} from '../packages/build/dist/index.js';
import {runtimeDirectory, RUNTIME_DESCRIPTOR, RUNTIME_STATE_SIZE, RUNTIME_ANIM_SIZE} from '../packages/runtime/dist/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/portable-v1.json', import.meta.url)));
function project() {
 const assets=structuredClone(fixture);
 const kinds={paletteConfig:'paletteConfigs',tileset:'tilesets',background:'backgrounds',overlay:'overlays',sprites:'tilesets',song:'songs',sound:'sounds'};
 return {assets,manifest:{format:'clementina-project',version:1,name:'Runtime demo',target:{machine:'clementina-6502'},program:{kind:'assembly',entry:'src/main.s'},assets:Object.fromEntries(Object.entries(assets).map(([k,a])=>[k,a.map((_,i)=>`assets/${k}/${i}.json`)])),build:{outputDirectory:'build',assembly:{linkerConfig:'link.cfg',outputName:'demo',loadAddress:0x1800,entrySymbol:'game_start'},assets:{slots:[{name:'work',mia:0x14000,size:0x10000},{name:'bank',bank:1,address:0x8000,size:0x4000}],include:Object.entries(kinds).map(([kind,list])=>({kind,id:assets[list][0].id,slot:'work'}))}}}};
}
const codes=r=>r.diagnostics.map(d=>d.code);
test('Builder validates slot placement, bounds, overlap and include references',()=>{
 assert.equal(checkProject(project()).ok,true);
 for(const [edit,code] of [
  [a=>a.slots.push({name:'work',mia:0x30000,size:16}),'project.build.slot.name'],
  [a=>a.slots.push({name:'bad',mia:0x100,size:16}),'project.build.slot.reserved'],
  [a=>a.slots.push({name:'bad',mia:0x3ffff,size:2}),'project.build.slot.reserved'],
  [a=>a.slots.push({name:'bad',mia:0x14001,size:16}),'project.build.slot.overlap'],
  [a=>a.slots.push({name:'bad',bank:31,address:0xbfff,size:2}),'project.build.slot.banks'],
  [a=>a.slots.push({name:'bad',bank:1,address:0x8000,size:2}),'project.build.slot.overlap'],
  [a=>a.slots.push({name:'bad',mia:0x30000,bank:2,address:0x8000,size:2}),'project.build.slot.place'],
  [a=>a.include.push({...a.include[0]}),'project.build.include.duplicate'],
  [a=>a.include[0].slot='missing','project.build.include.slot'],
  [a=>a.include[0].id='missing','project.build.include.id'],
  [a=>{a.include[0].file='SAME.BIN';a.include[1].file='same.bin'},'project.build.include.file'],
 ]) {const p=project();edit(p.manifest.build.assets);assert.ok(codes(checkProject(p)).includes(code),code);}
 const collision=project();collision.manifest.build.assets.slots.push({name:'work_',mia:0x30000,size:1});assert.ok(codes(checkProject(collision)).includes('project.build.slot.symbol'));
 const p=project();p.manifest.build.assets.slots.push({name:'next',mia:0x24000,size:1});assert.equal(checkProjectManifest(p.manifest).ok,true);
});
test('Builder emits all descriptor types, item tables, constants and alternative-slot report',()=>{
 const p=project(), r=planAssetBuild(p);assert.equal(r.ok,true,JSON.stringify(r.diagnostics));const plan=r.value;
 assert.deepEqual(plan.assets.map(a=>a.label),['PAL_MAIN','CHR_PLAYER','BG_LEVEL1','OVL_HUD','SPR_PLAYER','SONG_THEME','SFX_JUMP']);
 for(const a of plan.assets) {assert.match(a.file,/^[A-Z0-9_]{1,8}\.[A-Z]{2,3}$/);assert.equal(a.path,`ASSETS/${a.file}`);assert.ok(plan.assetsInc.includes(`${a.label}_SIZE = ${a.bytes.length}`));assert.ok(plan.assetsS.includes(`${a.label}:`));}
 assert.match(plan.assetsInc,/SHAPE_PLAYER_IDLE = 0/);assert.match(plan.assetsInc,/ANIM_PLAYER_IDLE = 0/);
 assert.match(plan.assetsS,/\.faraddr RT_NOT_LOADED, \$014000/);assert.match(plan.assetsS,/SPR_PLAYER_LOCS:/);assert.match(plan.assetsS,/\.repeat 2/);
 const slot=plan.report.slots.find(s=>s.name==='work');assert.equal(slot.assets.length,7);assert.equal(slot.used,Math.max(...plan.assets.map(a=>a.bytes.length)));
 assert.equal(plan.report.slots.find(s=>s.name==='bank').location,0x818000);
});
test('Builder reports size errors, partial-background and song-bank warnings',()=>{
 let p=project();p.manifest.build.assets.slots[0].size=1;let r=planAssetBuild(p);assert.equal(r.ok,false);assert.ok(codes(r).includes('build.assets.slot.size'));assert.ok(codes(r).includes('build.assets.slot.partial'));
 p=project();p.manifest.build.assets.include.find(a=>a.kind==='song').slot='bank';r=planAssetBuild(p);assert.equal(r.ok,true);assert.ok(codes(r).includes('build.assets.song.bank'));
 p=project();p.assets.songs[0].voices.forEach(v=>v.notes=[]);assert.ok(codes(planAssetBuild(p)).includes('build.assets.song.empty'));
});
test('Builder rejects song offsets that collide with the missing-voice sentinel',()=>{
 const p=project(), song=p.assets.songs[0], instruments=p.assets.instruments;
 song.length=4096;
 delete song.loopStart;
 song.voices[0].notes=Array.from({length:4096},(_,step)=>({step,length:1,pitch:48,instrumentId:instruments[step%2].id}));
 song.voices[1].notes=[{step:0,length:1,pitch:24,instrumentId:instruments[0].id}];
 p.manifest.build.assets.slots[0].size=0x20000;
 const checked=checkProject(p);
 assert.equal(checked.ok,true,JSON.stringify(checked.diagnostics));
 const result=planAssetBuild(p);
 assert.equal(result.ok,false);
 assert.ok(result.diagnostics.some(item=>item.code==='build.assets.encode'&&/voice offset/.test(item.message)));
});
test('Builder resolves normalized label and filename collisions deterministically',()=>{
 const p=project(),a=structuredClone(p.assets.tilesets[0]);a.id='tileset:other';p.assets.tilesets.push(a);p.manifest.build.assets.include.push({kind:'tileset',id:a.id,slot:'work'});
 const r=planAssetBuild(p);assert.equal(r.ok,true);assert.equal(r.value.assets.at(-1).label,'CHR_PLAYER_2');assert.equal(r.value.assets.at(-1).file,'PLAYER01.CHR');
});
test('Builder reserves explicit filenames before allocating generated names',()=>{
 const p=project();
 p.manifest.build.assets.folder='GAME/ASSETS';
 p.manifest.build.assets.include[1].file='MAIN.PAL';
 const planned=planAssetBuild(p);
 assert.equal(planned.ok,true,JSON.stringify(planned.diagnostics));
 assert.equal(planned.value.assets[0].file,'MAIN01.PAL');
 assert.equal(planned.value.assets[0].path,'GAME/ASSETS/MAIN01.PAL');
 assert.equal(planned.value.assets[1].file,'MAIN.PAL');
 assert.match(planned.value.assetsS,/GAME\/ASSETS\/MAIN01\.PAL/);
});
test('runtime CODE size ignores other segments and includes the last listing row',()=>{
 const listing=[
  '000000r 1               .segment "CODE"',
  '000000r 1  48                   pha',
  '000001r 1  AD EA FF             lda STATUS_L',
  '000004r 1  29 0C                and #$0C',
  '000006r 1               .segment "RODATA"',
  '000020r 1  AA                   .byte $AA',
 ].join('\n');
 assert.equal(runtimeCodeSize(listing),6);
});
test('runtime public constants match the assembly descriptor and state ABI',async()=>{
 const inc=await readFile(join(runtimeDirectory,'runtime.inc'),'utf8');
 for(const [key,value] of Object.entries({...Object.fromEntries(Object.entries(RUNTIME_DESCRIPTOR).map(([k,v])=>[`RT_D_${k}`,v])),RT_STATE_SIZE:RUNTIME_STATE_SIZE,RT_ANIM_SIZE:RUNTIME_ANIM_SIZE})) assert.match(inc,new RegExp(`^${key}\\s*=\\s*${value}\\s*(?:;|$)`,'m'));
});
const hasTools=['ca65','ld65','ar65'].every(t=>spawnSync(t,[t==='ar65'?'V':'--version'],{stdio:'ignore'}).status===0);
test('real toolchain builds the runtime demo, generated descriptors and SD card', {skip:!hasTools},async()=>{
 const root=await mkdtemp(join(tmpdir(),'clementina-runtime-'));
 await cp(new URL('../examples/runtime-demo/',import.meta.url),root,{recursive:true});
 const r=await buildProject(root);assert.equal(r.ok,true,JSON.stringify(r.diagnostics));assert.equal(r.value.sdRoot,'build/sd');assert.equal(r.value.loadPlan.steps.at(-1).path,'DEMO.PRG');
 assert.ok((await readFile(join(root,'build/runtime/runtime.lib'))).length>0);
 assert.ok(r.value.assets.report.runtimeCode['core.s']>900);
 assert.equal(r.value.assets.report.runtimeCode['zp.s'],0);
 assert.ok((await readFile(join(root,'build/sd/BOOT.BAS'))).length>0);
 assert.deepEqual(await readFile(join(root,'build/sd/DEMO.PRG')),Buffer.from(r.value.assembly.prg));
 // Disabling checks must assemble every library module too. An unreferenced
 // runtime stays out of the final code, even though all assets are described.
 const manifest=JSON.parse(await readFile(join(root,'clementina.yaml'),'utf8'));
 manifest.build.assets.checks=false;
 await writeFile(join(root,'clementina.yaml'),JSON.stringify(manifest));
 await writeFile(join(root,'src/main.s'),'.setcpu "65C02"\n.export game_start\n.segment "CODE"\ngame_start: jmp game_start\n');
 const minimal=await buildProject(root);assert.equal(minimal.ok,true,JSON.stringify(minimal.diagnostics));
 assert.equal(minimal.value.assembly.debug.segments.find(s=>s.name==='CODE').size,3);
 assert.ok(minimal.value.assets.report.runtimeCode['load.s']<r.value.assets.report.runtimeCode['load.s']);
});
