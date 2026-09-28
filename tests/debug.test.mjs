import test from 'node:test';
import assert from 'node:assert/strict';
import {EmulatorClient} from '../packages/emulator-client/dist/index.js';
import {ClementinaBasicDebugSession, ClementinaDebugSession, CLEMENTINA_CPU_FRAME_ID, CLEMENTINA_CPU_THREAD_ID, decodeInstructions} from '../packages/debug/dist/index.js';
import {createProjectDebugSession} from '../packages/debug/dist/node.js';
import {basicRuntimeDebug} from '../packages/basic/dist/index.js';

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

test('65C02 disassembly decodes branches and stops at unreadable bytes',()=>{
 assert.deepEqual(decodeInstructions(0x6000,[0x80,0xfe,0x0f,0x20,0xfb,0x03,null],4),[
  {address:0x6000,bytes:[0x80,0xfe],text:'BRA $6000'},
  {address:0x6002,bytes:[0x0f,0x20,0xfb],text:'BBR0 $20,$6000'},
  {address:0x6005,bytes:[0x03],text:'.byte $03'},
 ]);
 assert.throws(()=>decodeInstructions(0x6000,[0xea],65),RangeError);
});

test('debug session replaces source breakpoints while preserving external and shared addresses',async()=>{
 const active=[0x7000];
 const bankActive=[];
 const requests=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  if(request.method==='breakpoints')return {version:1,ok:true,result:[...active]};
  if(request.method==='bankBreakpoints')return {version:1,ok:true,result:[...bankActive]};
  if(request.method==='addBankBreakpoint'&&!bankActive.some(item=>item.address===request.address&&item.bank===request.bank))bankActive.push({address:request.address,bank:request.bank});
  if(request.method==='removeBankBreakpoint')bankActive.splice(bankActive.findIndex(item=>item.address===request.address&&item.bank===request.bank),1);
  if(request.method==='addBreakpoint'&&!active.includes(request.address))active.push(request.address);
  if(request.method==='removeBreakpoint'&&active.includes(request.address))active.splice(active.indexOf(request.address),1);
  return {version:1,ok:true,result:request.method.includes('BankBreakpoint')?[...bankActive]:[...active]};
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
  {path:'src/main.s',requestedLine:10,verified:true,line:10,addresses:[0x6000,0x6004],locations:[{address:0x6000},{address:0x6004}]},
  {path:'src/main.s',requestedLine:12,verified:true,line:12,addresses:[0x8000],locations:[{address:0x8000,bank:3}]},
  {path:'src/main.s',requestedLine:99,verified:false,addresses:[],message:'No executable code at this line'},
 ]);
 assert.deepEqual(active,[0x7000,0x6000,0x6004]);
 assert.deepEqual(bankActive,[{address:0x8000,bank:3}]);

 await session.setSourceBreakpoints('src/main.s',[11]);
 assert.deepEqual(active,[0x7000,0x6004]);
 assert.deepEqual(bankActive,[]);
 await session.clearSourceBreakpoints();
 assert.deepEqual(active,[0x7000]);
 assert.deepEqual(requests.filter(request=>request.method==='removeBreakpoint').map(request=>request.address),[0x6000,0x6004]);
 assert.deepEqual(requests.filter(request=>request.method==='removeBankBreakpoint').map(request=>[request.address,request.bank]),[[0x8000,3]]);
});

test('source breakpoints at one logical address retain independent physical banks',async()=>{
 const active=[];
 const client=new EmulatorClient(async request=>{
  if(request.method==='breakpoints')return {version:1,ok:true,result:[]};
  if(request.method==='bankBreakpoints')return {version:1,ok:true,result:[...active]};
  if(request.method==='addBankBreakpoint')active.push({address:request.address,bank:request.bank});
  if(request.method==='removeBankBreakpoint')active.splice(active.findIndex(item=>item.address===request.address&&item.bank===request.bank),1);
  return {version:1,ok:true,result:[...active]};
 });
 const session=new ClementinaDebugSession(client,sourceMap([
  {path:'one.s',line:1,address:0x8000,size:1,bank:1},
  {path:'two.s',line:1,address:0x8000,size:1,bank:2},
 ]));
 await session.setSourceBreakpoints('one.s',[1]);
 await session.setSourceBreakpoints('two.s',[1]);
 assert.deepEqual(active,[{address:0x8000,bank:1},{address:0x8000,bank:2}]);
 await session.setSourceBreakpoints('one.s',[]);
 assert.deepEqual(active,[{address:0x8000,bank:2}]);
 await session.dispose();
 assert.deepEqual(active,[]);
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

test('debug session uses the stopped physical bank for source, disassembly, and verified callers',async()=>{
 const requests=[];
 const map=sourceMap([
  {path:'bank1.s',line:3,address:0x8000,size:3,bank:1},
  {path:'bank2.s',line:7,address:0x8000,size:3,bank:2},
  {path:'main.s',line:10,address:0x6003,size:1},
 ]);
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  let result;
  if(request.method==='state')result=machineState({pc:0x8000,bank:2,sp:0xfd});
  else if(request.method==='readMemory')result=[0x20,0x03,0x60,0xea,0xea,0xea].slice(0,request.count);
  else if(request.method==='stackTrace')result={callers:[{pc:0x6003,bank:2,kind:'call'}],unknownCaller:true};
  else throw new Error(request.method);
  return {version:1,ok:true,result};
 });
 const session=new ClementinaDebugSession(client,map);
 const snapshot=await session.snapshot();
 assert.equal(snapshot.frame.source.path,'bank2.s');
 assert.equal(snapshot.frame.bank,2);
 assert.equal(snapshot.registers.bank,2);
 assert.deepEqual(await session.disassemble(0x8000,1),[{address:0x8000,bytes:[0x20,0x03,0x60],text:'JSR $6003',bank:2,source:{path:'bank2.s',line:7}}]);
 const stack=await session.stackTrace();
 assert.deepEqual(stack.frames.map(frame=>frame.source?.path),['bank2.s','main.s']);
 assert.equal(stack.unknownCaller,true);
 assert.ok(requests.some(request=>request.method==='readMemory'&&request.bank===2));
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

test('BASIC debug session filters the shared ROM statement hook by CURLIN and maps source lines',async()=>{
 let currentLine=10,polls=0;
 const active=[];
 const requests=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  if(request.method==='breakpoints')return {version:1,ok:true,result:[...active]};
  if(request.method==='addBreakpoint'){active.push(request.address);return {version:1,ok:true,result:[...active]};}
  if(request.method==='removeBreakpoint'){active.splice(active.indexOf(request.address),1);return {version:1,ok:true,result:[...active]};}
  if(request.method==='readMemory')return {version:1,ok:true,result:[currentLine&255,currentLine>>>8]};
  if(request.method==='state'){
   if(++polls===2)currentLine=30;
   return {version:1,ok:true,result:machineState({pc:basicRuntimeDebug.statementBoundaryAddress,stopReason:'breakpoint'})};
  }
  if(request.method==='resume')return {version:1,ok:true,result:machineState({pc:basicRuntimeDebug.statementBoundaryAddress,running:true,stopReason:'running'})};
  throw new Error(`unexpected ${request.method}`);
 });
 const session=new ClementinaBasicDebugSession(client,'/project/main.bas','10 PRINT "A"\n20\n30 END\n');
 const breakpoints=await session.setSourceBreakpoints('/project/main.bas',[2,3]);
 assert.deepEqual(breakpoints.map(item=>item.verified),[false,true]);
 const stopped=await session.waitForStop({timeoutMs:100,pollIntervalMs:1});
 assert.deepEqual(stopped.frame.source,{path:'/project/main.bas',line:3});
 assert.ok(requests.some(request=>request.method==='resume'));
 await session.dispose();
 assert.deepEqual(active,[]);
});
test('BASIC source stepping allows pause while waiting for the statement hook',async()=>{
 let current=machineState({stopReason:'reset'}), resumeStarted;
 const resumed=new Promise(resolve=>{resumeStarted=resolve});
 const client=new EmulatorClient(async request=>{
  if(request.method==='breakpoints'||request.method==='addBreakpoint'||request.method==='removeBreakpoint')return {version:1,ok:true,result:[]};
  if(request.method==='readMemory')return {version:1,ok:true,result:[10,0]};
  if(request.method==='state')return {version:1,ok:true,result:current};
  if(request.method==='resume'){
   current=machineState({running:true,stopReason:'running'});
   resumeStarted();
   return {version:1,ok:true,result:current};
  }
  if(request.method==='pause'){
   current=machineState({stopReason:'pause'});
   return {version:1,ok:true,result:current};
  }
  throw new Error(request.method);
 });
 const session=new ClementinaBasicDebugSession(client,'/project/main.bas','10 PRINT "A"\n');
 const stepping=session.stepIn({timeoutMs:200,pollIntervalMs:1});
 await resumed;
 assert.equal((await session.pause()).state.stopReason,'pause');
 assert.equal((await stepping).state.stopReason,'pause');
 await session.dispose();
});
test('BASIC source stepping stops the emulator when its host wait expires',async()=>{
 let current=machineState({stopReason:'reset'}), pauses=0;
 const client=new EmulatorClient(async request=>{
  if(request.method==='breakpoints'||request.method==='addBreakpoint'||request.method==='removeBreakpoint')return {version:1,ok:true,result:[]};
  if(request.method==='readMemory')return {version:1,ok:true,result:[10,0]};
  if(request.method==='state')return {version:1,ok:true,result:current};
  if(request.method==='resume'){current=machineState({running:true,stopReason:'running'});return {version:1,ok:true,result:current};}
  if(request.method==='pause'){pauses++;current=machineState({stopReason:'pause'});return {version:1,ok:true,result:current};}
  throw new Error(request.method);
 });
 const session=new ClementinaBasicDebugSession(client,'/project/main.bas','10 PRINT "A"\n');
 await assert.rejects(session.stepIn({timeoutMs:20,pollIntervalMs:1}),/Timed out waiting for a BASIC statement boundary/);
 assert.equal(pauses,1);
 assert.equal((await session.snapshot()).state.stopReason,'pause');
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
 const build={kind:'assembly',sdRoot:'build/sd',diagnostics:[],
  assembly:{binary:Uint8Array.of(0x60),prg:Uint8Array.of(0,0x60,0x60),loadStep:{kind:'prg',path:'build/game.prg',loadAddress:0x6000,length:1,runAddress:0x6000},entryAddress:0x6000,debug,artifacts:{binary:'',prg:'',debug:'',map:'',labels:'',objects:[],listings:[]}},
  loadPlan:{format:'clementina-load-plan',version:1,steps:[{kind:'prg',path:'build/game.prg',loadAddress:0x6000,length:1,runAddress:0x6000}]},
  bootstrapSource:'10 BLOAD "build/game.prg",24576,24576\n',files:[],
 };
 let closed=0;
 const created=await createProjectDebugSession('/project',{threadName:'Editor CPU'},{
  build:async()=>({ok:true,value:build,diagnostics:[]}),
  startProcess:async options=>{
   assert.equal(options.sdRoot,'/project/build/sd');
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

 const basicBuild={kind:'basic',sdRoot:'.',diagnostics:[],basic:{source:'main.bas',artifact:'build/game.bas',bytes:Uint8Array.of(0,0),lines:1},loadPlan:{},files:[]};
 const basicCreated=await createProjectDebugSession('/project',{}, {
  build:async()=>({ok:true,value:basicBuild,diagnostics:[]}),
  readBasicSource:async()=>({path:'/project/main.bas',text:'10 END\n'}),
  startProcess:async()=>({endpoint:'http://127.0.0.1:1234/v1',client:new EmulatorClient(async request=>({version:1,ok:true,result:request.method==='breakpoints'?[]:machineState()})),pid:1,exited:Promise.resolve({code:0,signal:null}),close:async()=>({code:0,signal:null})}),
 });
 assert.equal(basicCreated.ok,true);
 await basicCreated.value.close();

 const minimal={kind:'assembly',sdRoot:'.',diagnostics:[],assembly:{loadStep:{},debug:{files:[],lines:[],segments:[],spans:[]}},loadPlan:{},bootstrapSource:'',files:[]};
 const notStarted=await createProjectDebugSession('/project',{}, {
  build:async()=>({ok:true,value:minimal,diagnostics:[]}),startProcess:async()=>{throw new Error('spawn failed');},
 });
 assert.equal(notStarted.ok,false);
 assert.equal(notStarted.diagnostics[0].code,'debug.emulator-startup');
 assert.match(notStarted.diagnostics[0].message,/spawn failed/);
});
