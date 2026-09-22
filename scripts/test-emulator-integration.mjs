// Explicit cross-repository check. Build both Go commands first; see docs/emulator-automation.md.
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodePrg} from '../packages/basic/dist/index.js';
import {createHttpEmulatorClient} from '../packages/emulator-client/dist/index.js';
const [emulator,renderer]=process.argv.slice(2);
if(!emulator||!renderer)throw new Error('Usage: node scripts/test-emulator-integration.mjs <emulator-binary> <renderer-binary>');
const sdRoot=await mkdtemp(join(tmpdir(),'clementina-sdk-integration-'));
await writeFile(join(sdRoot,'PALETTE.BIN'),Uint8Array.of(0xe0,0x07));
await writeFile(join(sdRoot,'GAME.PRG'),encodePrg(Uint8Array.of(0xa9,42,0x8d,0xf0,0x02,0x4c,0x05,0x60),0x6000));
const child=spawn(emulator,['-sd',sdRoot],{stdio:['ignore','pipe','inherit']});
const exited=once(child,'exit');
const lines=createInterface({input:child.stdout});
const timer=setTimeout(()=>child.kill(),30000);
try {
 const [endpoint]=await Promise.race([once(lines,'line'),exited.then(()=>{throw new Error('Emulator exited before readiness');})]);
 const client=createHttpEmulatorClient(endpoint);
 assert.equal((await client.capabilities()).version,1);
 assert.equal((await client.reset()).cycles,'3');
 assert.equal((await client.step(4000000)).cycles,'4000003');
 await client.input(Array.from(Buffer.from('POKE 752,42\r','ascii')));
 await client.step(600000);
 assert.deepEqual(await client.readMemory(752,1),[42]);
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
  {kind:'prg',path:'GAME.PRG',loadAddress:0x6000,length:8,runAddress:0x6000},
 ]};
 await client.launchLoadPlan(plan);
 for(let i=0;i<200;i++){
  stopped=await client.state();
  if(!stopped.running)break;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(stopped.stopReason,'breakpoint');assert.equal(stopped.pc,0x6005);
 assert.deepEqual(await client.readMemory(0x02f0,1),[42]);
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
 console.log('Go emulator → generated BASIC bootstrap → PRG/MIA load → debugger/render: passed');
} finally {clearTimeout(timer);lines.close();child.kill();await exited;await rm(sdRoot,{recursive:true,force:true});}
