// Explicit cross-repository check. Build both Go commands first; see docs/emulator-automation.md.
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileBasicProgram,detokenizeBasicProgram,encodePrg,inspectBasicProgram} from '../packages/basic/dist/index.js';
import {startEmulatorProcess} from '../packages/emulator-client/dist/node.js';
const [emulator,renderer]=process.argv.slice(2);
if(!emulator||!renderer)throw new Error('Usage: node scripts/test-emulator-integration.mjs <emulator-binary> <renderer-binary>');
const sdRoot=await mkdtemp(join(tmpdir(),'clementina-sdk-integration-'));
await writeFile(join(sdRoot,'PALETTE.BIN'),Uint8Array.of(0xe0,0x07));
const basicSource='10 POKE 753,43\n20 END\n';
await writeFile(join(sdRoot,'PROGRAM.BAS'),compileBasicProgram(basicSource));
await writeFile(join(sdRoot,'GAME.PRG'),encodePrg(Uint8Array.of(
 0xa9,42,             // $6000: LDA #42
 0x8d,0xf0,0x02,     // $6002: STA $02F0
 0x20,0x0b,0x60,     // $6005: JSR $600B
 0x4c,0x08,0x60,     // $6008: JMP $6008
 0xe8,                // $600B: INX
 0x60,                // $600C: RTS
),0x6000));
let emulatorProcess;
try {
 emulatorProcess=await startEmulatorProcess({executable:emulator,sdRoot,startupTimeoutMs:30000,onStderr:text=>process.stderr.write(text)});
 const endpoint=emulatorProcess.endpoint,client=emulatorProcess.client;
 assert.equal((await client.capabilities()).version,1);
 assert.equal((await client.reset()).cycles,'3');
 assert.equal((await client.step(4000000)).cycles,'4000003');
 await client.input(Array.from(Buffer.from('POKE 752,42\r','ascii')));
 await client.step(600000);
 assert.deepEqual(await client.readMemory(752,1),[42]);
 await client.input(Array.from(Buffer.from('10 POKE 753,43\r','ascii')));
 await client.step(600000);
 await client.input(Array.from(Buffer.from('20 END\r','ascii')));
 await client.step(600000);
 await client.input(Array.from(Buffer.from('SAVE "ROMTOK.BAS"\r','ascii')));
 await client.step(600000);
 assert.deepEqual(
  inspectBasicProgram(await readFile(join(sdRoot,'ROMTOK.BAS'))).lines.map(line=>line.tokens),
  inspectBasicProgram(compileBasicProgram(basicSource)).lines.map(line=>line.tokens),
 );
 await client.input(Array.from(Buffer.from('LOAD "PROGRAM.BAS"\r','ascii')));
 await client.step(600000);
 await client.input(Array.from(Buffer.from('RUN\r','ascii')));
 await client.step(600000);
 assert.deepEqual(await client.readMemory(753,1),[43]);
 await client.input(Array.from(Buffer.from('SAVE "ROUND.BAS"\r','ascii')));
 await client.step(600000);
 assert.equal(detokenizeBasicProgram(await readFile(join(sdRoot,'ROUND.BAS'))),basicSource);
 assert.deepEqual(await client.readMemory(49152,1),[null]);
 const boundary=await client.stepInstruction(1000);
 assert.equal(boundary.instructionBoundary,true);
 await client.addBreakpoint(boundary.pc);
 assert.deepEqual(await client.breakpoints(),[boundary.pc]);
 await client.run();
 let stopped;
 for(let i=0;i<100;i++){
  stopped=await client.state();
  if(!stopped.running)break;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(stopped.stopReason,'breakpoint');assert.equal(stopped.pc,boundary.pc);
 assert.equal(stopped.cycles,boundary.cycles);
 await client.clearBreakpoints();
 assert.equal((await client.resume()).running,true);
 const paused=await client.pause();assert.equal(paused.running,false);
 assert.equal((await client.state()).cycles,paused.cycles);
 await client.clearBreakpoints();
 await client.addBreakpoint(0x6005);
 const plan={format:'clementina-load-plan',version:1,steps:[
  {kind:'mia',path:'PALETTE.BIN',address:256,length:2},
  {kind:'prg',path:'GAME.PRG',loadAddress:0x6000,length:13,runAddress:0x6000},
 ]};
 await client.launchLoadPlan(plan);
 for(let i=0;i<200;i++){
  stopped=await client.state();
  if(!stopped.running)break;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(stopped.stopReason,'breakpoint');assert.equal(stopped.pc,0x6005);
 assert.deepEqual(await client.readMemory(0x02f0,1),[42]);
 const integrationSourceMap={
  locationsForSource:()=>[],
  locationsForAddress:address=>[
   {path:'src/main.s',line:3,address:0x6005,size:3},
   {path:'src/main.s',line:4,address:0x6008,size:3},
   {path:'src/helper.s',line:1,address:0x600b,size:1},
   {path:'src/helper.s',line:2,address:0x600c,size:1},
  ].filter(location=>address>=location.address&&address<location.address+location.size),
 };
 const beforeX=stopped.x;
 const sourceStep=await client.stepOverSource(integrationSourceMap,{maxInstructions:8});
 assert.equal(sourceStep.reason,'source-location');assert.equal(sourceStep.steppedOverCall,true);
 assert.equal(sourceStep.instructions,3);assert.equal(sourceStep.state.pc,0x6008);
 assert.equal(sourceStep.state.x,(beforeX+1)&0xff);
 await client.clearBreakpoints();
 const basicPlan={format:'clementina-load-plan',version:1,steps:[
  {kind:'mia',path:'PALETTE.BIN',address:256,length:2},
  {kind:'basic',path:'PROGRAM.BAS',length:compileBasicProgram(basicSource).length},
 ]};
 await client.launchLoadPlan(basicPlan);
 await new Promise(resolve=>setTimeout(resolve,200));
 const basicRunPaused=await client.pause();
 assert.equal(basicRunPaused.running,false);
 assert.deepEqual(await client.readMemory(753,1),[43]);
 const video=await client.video();
 assert.deepEqual(video.slice(256,258),[0xe0,0x07]);
 const png=spawnSync(renderer,[],{input:JSON.stringify(video),maxBuffer:1048576});
 assert.equal(png.status,0,png.stderr.toString());
 assert.equal(png.stdout.subarray(1,4).toString(),'PNG');
 assert.equal(png.stdout.readUInt32BE(16),320);assert.equal(png.stdout.readUInt32BE(20),200);
 const denied=await fetch(endpoint,{method:'POST',headers:{Origin:'https://example.com'},body:'{}'});
 assert.equal(denied.status,403);
 const invalid=await fetch(endpoint,{method:'POST',body:'{"version":2,"method":"reset"}'});
 assert.equal((await invalid.json()).ok,false);
 console.log('Go emulator → compiled BASIC LOAD/SAVE → generated bootstrap → PRG/MIA load → BASIC load plan → debugger/render: passed');
} finally {if(emulatorProcess)await emulatorProcess.close();await rm(sdRoot,{recursive:true,force:true});}
