import test from 'node:test';
import assert from 'node:assert/strict';
import {EmulatorClient} from '../packages/emulator-client/dist/index.js';
import {ClementinaDebugSession, CLEMENTINA_CPU_FRAME_ID, CLEMENTINA_CPU_THREAD_ID} from '../packages/debug/dist/index.js';
import {createProjectDebugSession} from '../packages/debug/dist/node.js';

const machineState=(overrides={})=>({
 cycles:'12',pc:0x6000,a:1,x:2,y:3,sp:0xff,p:0x24,paused:false,
 running:false,stopReason:'breakpoint',instructionBoundary:true,...overrides,
});

const sourceMap=(entries,observedBanks=[])=>({
 locationsForSource:(path,line)=>entries.filter(entry=>entry.path===path&&entry.line===line),
 locationsForAddress:(address,bank)=>{
  observedBanks.push(bank);
  return entries.filter(entry=>address>=entry.address&&address<entry.address+entry.size
   &&(bank===undefined||entry.bank===undefined||entry.bank===bank));
 },
});

test('debug session replaces source breakpoints while preserving external and shared addresses',async()=>{
 const active=[0x7000];
 const requests=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  if(request.method==='breakpoints')return {version:1,ok:true,result:[...active]};
  if(request.method==='addBreakpoint'&&!active.includes(request.address))active.push(request.address);
  if(request.method==='removeBreakpoint'&&active.includes(request.address))active.splice(active.indexOf(request.address),1);
  return {version:1,ok:true,result:[...active]};
 });
 const map=sourceMap([
  {path:'src/main.s',line:10,address:0x6000,size:2},
  {path:'src/main.s',line:10,address:0x6004,size:1},
  {path:'src/main.s',line:11,address:0x6004,size:1},
  {path:'src/main.s',line:12,address:0x8000,size:1,bank:3},
  {path:'src/main.s',line:12,address:0x8000,size:1,bank:4},
 ]);
 const session=new ClementinaDebugSession(client,map,{bank:3});
 const first=await session.setSourceBreakpoints('src/main.s',[10,12,99]);
 assert.deepEqual(first,[
  {path:'src/main.s',requestedLine:10,verified:true,line:10,addresses:[0x6000,0x6004]},
  {path:'src/main.s',requestedLine:12,verified:true,line:12,addresses:[0x8000],message:'Breakpoint uses a logical CPU address and is not bank-selective'},
  {path:'src/main.s',requestedLine:99,verified:false,addresses:[],message:'No executable code at this line'},
 ]);
 assert.deepEqual(active,[0x7000,0x6000,0x6004,0x8000]);

 await session.setSourceBreakpoints('src/main.s',[11]);
 assert.deepEqual(active,[0x7000,0x6004]);
 await session.clearSourceBreakpoints();
 assert.deepEqual(active,[0x7000]);
 assert.deepEqual(requests.filter(request=>request.method==='removeBreakpoint').map(request=>request.address),[0x6000,0x8000,0x6004]);
});

test('debug session exposes one source-aware CPU frame and raw registers',async()=>{
 const observedBanks=[];
 const map=sourceMap([{path:'src/main.s',line:8,address:0x6000,size:2}],observedBanks);
 const client=new EmulatorClient(async request=>({version:1,ok:true,result:request.method==='state'?machineState():[]}));
 const session=new ClementinaDebugSession(client,map,{bank:3,threadName:'Game CPU'});
 assert.deepEqual(session.threads(),[{id:CLEMENTINA_CPU_THREAD_ID,name:'Game CPU'}]);
 const snapshot=await session.snapshot();
 assert.deepEqual(snapshot.thread,{id:1,name:'Game CPU'});
 assert.equal(snapshot.frame.id,CLEMENTINA_CPU_FRAME_ID);
 assert.equal(snapshot.frame.instructionPointer,0x6000);
 assert.deepEqual(snapshot.frame.source,{path:'src/main.s',line:8});
 assert.equal(snapshot.frame.name,'main.s:8');
 assert.deepEqual(snapshot.registers,{pc:0x6000,a:1,x:2,y:3,sp:0xff,p:0x24,cycles:'12',miaPaused:false});
 assert.deepEqual(observedBanks,[3]);
});

test('debug session maps execution controls and source stepping without editor-specific transport',async()=>{
 let current=machineState();
 const requests=[];
 const map=sourceMap([
  {path:'src/main.s',line:8,address:0x6000,size:1},
  {path:'src/main.s',line:9,address:0x6001,size:1},
 ]);
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  if(request.method==='state')return {version:1,ok:true,result:current};
  if(request.method==='stepInstruction'){current=machineState({pc:0x6001,stopReason:'instruction'});return {version:1,ok:true,result:current};}
  if(request.method==='resume'){current=machineState({running:true,stopReason:'running'});return {version:1,ok:true,result:current};}
  if(request.method==='pause'){current=machineState({pc:0x6001,stopReason:'pause'});return {version:1,ok:true,result:current};}
  throw new Error(`unexpected ${request.method}`);
 });
 const session=new ClementinaDebugSession(client,map);
 const stepped=await session.stepIn({maxInstructions:2});
 assert.equal(stepped.reason,'source-location');
 assert.equal(stepped.state.pc,0x6001);
 assert.equal((await session.continue()).running,true);
 assert.equal((await session.pause()).state.stopReason,'pause');
 assert.deepEqual(requests.map(request=>request.method),['state','stepInstruction','resume','pause']);
});

test('debug session waits for a stop and disposal removes only its breakpoints',async()=>{
 let polls=0;
 const active=[];
 const map=sourceMap([{path:'src/main.s',line:1,address:0x6000,size:1}]);
 const client=new EmulatorClient(async request=>{
  if(request.method==='state')return {version:1,ok:true,result:++polls<2?machineState({running:true,stopReason:'running'}):machineState({stopReason:'breakpoint'})};
  if(request.method==='breakpoints')return {version:1,ok:true,result:[...active]};
  if(request.method==='addBreakpoint'){active.push(request.address);return {version:1,ok:true,result:[...active]};}
  if(request.method==='removeBreakpoint'){active.splice(active.indexOf(request.address),1);return {version:1,ok:true,result:[...active]};}
  throw new Error(`unexpected ${request.method}`);
 });
 const session=new ClementinaDebugSession(client,map);
 await session.setSourceBreakpoints('src/main.s',[1]);
 const stopped=await session.waitForStop({timeoutMs:100,pollIntervalMs:1});
 assert.equal(stopped.state.stopReason,'breakpoint');
 await session.dispose();
 assert.deepEqual(active,[]);
 await assert.rejects(session.snapshot(),/disposed/);
 await session.dispose();
});

test('Node debug composition builds and prepares breakpoints before launching the BASIC plan',async()=>{
 const requests=[];
 const stopped=machineState({pc:0x6000,stopReason:'reset'}),running=machineState({pc:0x6000,running:true,stopReason:'running'});
 let active=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  if(request.method==='breakpoints')return {version:1,ok:true,result:[...active]};
  if(request.method==='addBreakpoint'){active=[...new Set([...active,request.address])];return {version:1,ok:true,result:[...active]};}
  if(request.method==='removeBreakpoint'){active=active.filter(address=>address!==request.address);return {version:1,ok:true,result:[...active]};}
  return {version:1,ok:true,result:request.method==='run'?running:stopped};
 });
 const debug={
  version:{major:2,minor:0},files:[{id:0,path:'src/main.s'}],
  lines:[{id:0,fileId:0,line:5,spanIds:[0]}],
  segments:[{id:0,name:'CODE',start:0x6000,size:1}],
  spans:[{id:0,segmentId:0,start:0,size:1}],symbols:[],
 };
 const build={kind:'assembly',
  assembly:{binary:Uint8Array.of(0x60),prg:Uint8Array.of(0,0x60,0x60),loadStep:{kind:'prg',path:'build/game.prg',loadAddress:0x6000,length:1,runAddress:0x6000},entryAddress:0x6000,debug,artifacts:{binary:'',prg:'',debug:'',map:'',labels:'',objects:[],listings:[]}},
  loadPlan:{format:'clementina-load-plan',version:1,steps:[{kind:'prg',path:'build/game.prg',loadAddress:0x6000,length:1,runAddress:0x6000}]},
  bootstrapSource:'10 BLOAD "build/game.prg",24576,24576\n',files:[],
 };
 let closed=0;
 const created=await createProjectDebugSession('/project',{threadName:'Editor CPU'},{
  build:async()=>({ok:true,value:build,diagnostics:[]}),
  startProcess:async options=>{
   assert.equal(options.sdRoot,'/project');
   return {endpoint:'http://127.0.0.1:1234/v1',client,pid:42,exited:Promise.resolve({code:0,signal:null}),close:async()=>{closed++;return {code:0,signal:null};}};
  },
 });
 assert.equal(created.ok,true);
 assert.equal(created.value.endpoint,'http://127.0.0.1:1234/v1');
 await created.value.session.setSourceBreakpoints('src/main.s',[5]);
 assert.deepEqual(requests.map(request=>request.method),['breakpoints','addBreakpoint']);
 assert.equal((await created.value.launch({bootCycles:1,inputCycles:1})).running,true);
 assert.deepEqual(requests.map(request=>request.method),['breakpoints','addBreakpoint','reset','step','input','step','input','run']);
 await created.value.close();
 await created.value.close();
 assert.equal(closed,1);
 assert.equal(active.length,0);
});

test('Node debug composition reports build and emulator startup diagnostics',async()=>{
 const buildFailure={ok:false,diagnostics:[{severity:'error',code:'build.failed',path:'',message:'bad build'}]};
 const notBuilt=await createProjectDebugSession('/project',{}, {build:async()=>buildFailure,startProcess:async()=>{throw new Error('must not start');}});
 assert.deepEqual(notBuilt,buildFailure);

 const basicBuild={kind:'basic',basic:{source:'main.bas',artifact:'build/game.bas',bytes:Uint8Array.of(0,0),lines:0},loadPlan:{},files:[]};
 const rejectedBasic=await createProjectDebugSession('/project',{}, {
  build:async()=>({ok:true,value:basicBuild,diagnostics:[]}),startProcess:async()=>{throw new Error('must not start');},
 });
 assert.equal(rejectedBasic.ok,false);
 assert.equal(rejectedBasic.diagnostics[0].code,'debug.program-kind');

 const minimal={kind:'assembly',assembly:{loadStep:{},debug:{files:[],lines:[],segments:[],spans:[]}},loadPlan:{},bootstrapSource:'',files:[]};
 const notStarted=await createProjectDebugSession('/project',{}, {
  build:async()=>({ok:true,value:minimal,diagnostics:[]}),startProcess:async()=>{throw new Error('spawn failed');},
 });
 assert.equal(notStarted.ok,false);
 assert.equal(notStarted.diagnostics[0].code,'debug.emulator-startup');
 assert.match(notStarted.diagnostics[0].message,/spawn failed/);
});
