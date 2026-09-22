import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeCommand,runCli} from '../packages/cli/dist/index.js';
const bin=new URL('../packages/cli/bin/clementina.mjs',import.meta.url);
const run=(...args)=>spawnSync(process.execPath,[bin.pathname,...args],{encoding:'utf8'});
test('CLI commands validate the example through shared APIs',async()=>{
 for(const args of [
  ['project','validate','examples/minimal-game'],
  ['asset','validate','examples/minimal-game/assets/palettes/main.palette.json'],
  ['sprite','validate','examples/minimal-game/assets/shapes/player_idle.shape.json'],
  ['animation','validate','examples/minimal-game/assets/animations/player_idle.animation.json'],
  ['doctor'],
 ]){const r=run(...args,'--json');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);}
});
test('CLI failures have predictable exit codes and JSON-only stdout',()=>{
 for(const [args,status,code] of [
  [['asset','validate','missing.json'],1,'asset.io'],
  [['asset','validate','package.json'],1,'asset.format'],
  [['project','validate','missing'],1,'project.io'],
  [['sprite','validate'],2,'cli.usage'],
  [['doctor','extra'],2,'cli.usage'],
  [['build','one','two'],2,'cli.usage'],
  [['build','examples/minimal-game'],1,'build.configuration'],
  [['run','--port','70000'],2,'cli.usage'],
 ]){const r=run(...args,'--json');assert.equal(r.status,status);assert.equal(r.stderr,'');assert.equal(JSON.parse(r.stdout).diagnostics[0].code,code);}
});
test('run composes project build, owned emulator lifecycle, and load-plan launch',async()=>{
 const plan={format:'clementina-load-plan',version:1,steps:[{kind:'prg',path:'build/game.prg',loadAddress:0x6000,length:1,runAddress:0x6000}]};
 const state={cycles:'1',pc:0x6000,a:0,x:0,y:0,sp:0xff,p:0x30,paused:false,running:true,stopReason:'running',instructionBoundary:true};
 let buildRoot,options,launched,resolveExit,closed=0;
 const exited=new Promise(resolve=>resolveExit=resolve);
 const emulator={endpoint:'http://127.0.0.1:1234/v1',pid:42,exited,client:{launchLoadPlan:async value=>(launched=value,state)},close:async()=>{closed++;const value={code:0,signal:null};resolveExit(value);return value;}};
 const result=await executeCommand(['run','game','--emulator','/tools/emulator','--port','6503'],'/workspace',{
  buildProject:async root=>{buildRoot=root;return {ok:true,value:{kind:'assembly',loadPlan:plan,assembly:{entryAddress:0x6000},files:[]},diagnostics:[]}},
  startEmulatorProcess:async value=>(options=value,emulator),
 });
 assert.equal(result.ok,true);assert.equal(result.session.emulator,emulator);assert.deepEqual(launched,plan);
 assert.equal(buildRoot,'/workspace/game');assert.deepEqual(options,{executable:'/tools/emulator',sdRoot:'/workspace/game',port:6503});
 assert.deepEqual(result.data,{endpoint:emulator.endpoint,pid:42,kind:'assembly',entryAddress:0x6000});
 await result.session.emulator.close();assert.equal(closed,1);
});
test('build and run compose a BASIC project through the same discriminated contract',async()=>{
 const basicBuild={kind:'basic',loadPlan:{format:'clementina-load-plan',version:1,steps:[{kind:'basic',path:'build/game.bas',length:2}]},
  basic:{source:'main.bas',artifact:'build/game.bas',bytes:Uint8Array.of(0,0),lines:0},
  files:[{kind:'basic',path:'build/game.bas',length:2},{kind:'load-plan',path:'build/load-plan.json',length:0}]};
 const built=await executeCommand(['build','game'],'/workspace',{buildProject:async()=>({ok:true,value:basicBuild,diagnostics:[]})});
 assert.equal(built.ok,true);
 assert.deepEqual(built.data,{kind:'basic',program:'build/game.bas',loadPlan:'build/load-plan.json',lines:0});

 const state={cycles:'1',pc:0,a:0,x:0,y:0,sp:0xff,p:0x30,paused:false,running:true,stopReason:'running',instructionBoundary:true};
 let launched,resolveExit;
 const exited=new Promise(resolve=>resolveExit=resolve);
 const emulator={endpoint:'http://127.0.0.1:1234/v1',pid:7,exited,client:{launchLoadPlan:async value=>(launched=value,state)},close:async()=>{const value={code:0,signal:null};resolveExit(value);return value;}};
 const ran=await executeCommand(['run','game'],'/workspace',{
  buildProject:async()=>({ok:true,value:basicBuild,diagnostics:[]}),
  startEmulatorProcess:async()=>emulator,
 });
 assert.equal(ran.ok,true);assert.deepEqual(launched,basicBuild.loadPlan);
 assert.deepEqual(ran.data,{endpoint:emulator.endpoint,pid:7,kind:'basic',program:'build/game.bas'});
 await ran.session.emulator.close();
});
test('wrong asset kind is rejected and help documents reference scope',async()=>{
 assert.equal((await executeCommand(['animation','validate','examples/minimal-game/assets/shapes/player_idle.shape.json'])).exitCode,1);
 const output=[];assert.equal(await runCli(['--help'],{stdout:t=>output.push(t),stderr:t=>assert.fail(t)}),0);
 assert.match(output.join(''),/project validate for references/);
});
test('basic compile writes the ROM LOAD format through the shared tokenizer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'clementina-basic-cli-'));
 await writeFile(join(root,'main.bas'),'10 PRINT "HELLO"\n20 END\n');
 const result=await executeCommand(['basic','compile','main.bas','game.bas'],root);
 assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
 assert.deepEqual(result.data,{source:'main.bas',output:'game.bas',bytes:22,lines:2});
 assert.deepEqual(Array.from((await readFile(join(root,'game.bas'))).slice(-2)),[0,0]);
});
