import test from 'node:test';
import assert from 'node:assert/strict';
import {EmulatorClient, EmulatorError, createHttpEmulatorClient} from '../packages/emulator-client/dist/index.js';
const state={cycles:'0',pc:0,a:0,x:0,y:0,sp:0,p:48,paused:false};
test('automation client validates requests before transport and checks replies',async()=>{
 const requests=[];
 const client=new EmulatorClient(async r=>{requests.push(r);return {version:1,ok:true,result:state};});
 assert.deepEqual(await client.step(3),state);
 assert.deepEqual(requests,[{version:1,method:'step',count:3}]);
 for(const n of [0,-1,1.5,NaN,10000001])assert.throws(()=>client.step(n),RangeError);
 assert.throws(()=>client.readMemory(65535,2),RangeError);
 assert.throws(()=>client.input([256]),RangeError);
 assert.throws(()=>client.input(new Array(2)),RangeError);
 assert.equal(requests.length,1);
 for(const reply of [null,{version:2,ok:true,result:state},{version:1,ok:true,result:{...state,pc:65536}},{version:1,ok:false,error:'bad request'}]){
  await assert.rejects(new EmulatorClient(async()=>reply).state(),EmulatorError);
 }
});
test('memory holes are retained and invalid video bytes are rejected',async()=>{
 const c=new EmulatorClient(async()=>({version:1,ok:true,result:[null,255]}));
 assert.deepEqual(await c.readMemory(49151,2),[null,255]);
 await assert.rejects(c.video(),EmulatorError);
});
test('HTTP errors and transport failures are not retried',async()=>{
 let calls=0;
 const c=createHttpEmulatorClient('http://127.0.0.1:1234/v1',async()=>{calls++;return new Response('',{status:403});});
 await assert.rejects(c.reset(),/HTTP 403/);assert.equal(calls,1);
 const failure=new EmulatorClient(async()=>{throw new Error('connection lost');});
 await assert.rejects(failure.step(1),/connection lost/);
});
test('execution controls preserve stop details and validate breakpoint replies',async()=>{
 const stopped={...state,running:false,stopReason:'breakpoint',instructionBoundary:true};
 const requests=[];
 const client=new EmulatorClient(async r=>{requests.push(r);return {version:1,ok:true,result:stopped};});
 for(const method of ['run','pause','resume','stepInstruction'])assert.deepEqual(await client[method](),stopped);
 assert.deepEqual(requests.map(r=>r.method),['run','pause','resume','stepInstruction']);
 assert.equal(requests[3].count,10000);
 assert.throws(()=>client.stepInstruction(0),RangeError);
 assert.throws(()=>client.addBreakpoint(65536),RangeError);
 assert.throws(()=>client.removeBreakpoint(-1),RangeError);
 for(const result of [state,{...stopped,running:1},{...stopped,stopReason:'unknown'}]){
  await assert.rejects(new EmulatorClient(async()=>({version:1,ok:true,result})).run(),EmulatorError);
 }
 for(const result of [[0,65535],[]]){
  const c=new EmulatorClient(async()=>({version:1,ok:true,result}));
  assert.deepEqual(await c.breakpoints(),result);
 }
 for(const result of [[65536],[1,1],null])await assert.rejects(new EmulatorClient(async()=>({version:1,ok:true,result})).breakpoints(),EmulatorError);
});

test('source breakpoints resolve exact emitted spans through the address API',async()=>{
 const requests=[];
 const active=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  if(request.method==='addBreakpoint'&&!active.includes(request.address))active.push(request.address);
  if(request.method==='removeBreakpoint')active.splice(active.indexOf(request.address),active.includes(request.address)?1:0);
  return {version:1,ok:true,result:[...active]};
 });
 const sourceMap={locationsForSource:(path,line)=>path==='src/main.s'&&line===8?[
  {address:0x8000,bank:3},{address:0x8004,bank:3},{address:0x8000,bank:3},
 ]:[]};
 assert.deepEqual(await client.addSourceBreakpoint(sourceMap,'src/main.s',8),{
  path:'src/main.s',line:8,addresses:[0x8000,0x8004],banked:true,breakpoints:[0x8000,0x8004],
 });
 assert.deepEqual(requests.map(({method,address})=>({method,address})),[
  {method:'addBreakpoint',address:0x8000},{method:'addBreakpoint',address:0x8004},
 ]);
 assert.deepEqual((await client.removeSourceBreakpoint(sourceMap,'src/main.s',8)).breakpoints,[]);
 await assert.rejects(client.addSourceBreakpoint(sourceMap,'src/main.s',9),/No executable code/);
 await assert.rejects(client.addSourceBreakpoint({locationsForSource:()=>[{address:65536}]},'src/main.s',8),/Invalid source map/);
});

const execution=(pc,sp=0xff,extra={})=>({...state,pc,sp,running:false,stopReason:'instruction',instructionBoundary:true,...extra});
const sourceMapFor=(entries)=>({
 locationsForSource:()=>[],
 locationsForAddress:address=>entries.filter(entry=>address>=entry.address&&address<entry.address+entry.size),
});

test('source stepping advances through same-line spans to the next exact location',async()=>{
 const states=[execution(0x6001),execution(0x6002)];
 const requests=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  const result=request.method==='state'?execution(0x6000):states.shift();
  return {version:1,ok:true,result};
 });
 const map=sourceMapFor([
  {path:'src/main.s',line:10,address:0x6000,size:2},
  {path:'src/main.s',line:11,address:0x6002,size:1},
 ]);
 const stepped=await client.stepSource(map,{maxInstructions:4,maxCyclesPerInstruction:50});
 assert.equal(stepped.reason,'source-location');
 assert.equal(stepped.instructions,2);
 assert.equal(stepped.state.pc,0x6002);
 assert.deepEqual(stepped.locations.map(({path,line})=>({path,line})),[{path:'src/main.s',line:11}]);
 assert.deepEqual(requests.map(request=>request.method),['state','stepInstruction','stepInstruction']);
 assert.deepEqual(requests.slice(1).map(request=>request.count),[50,50]);
});

test('source step-over recognizes the emulator JSR and waits for its matching return',async()=>{
 const states=[execution(0x7000,0xfd),execution(0x7001,0xfd),execution(0x6003,0xff)];
 const requests=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  if(request.method==='state')return {version:1,ok:true,result:execution(0x6000,0xff)};
  if(request.method==='readMemory')return {version:1,ok:true,result:[0x20]};
  return {version:1,ok:true,result:states.shift()};
 });
 const map=sourceMapFor([
  {path:'src/main.s',line:20,address:0x6000,size:3},
  {path:'src/main.s',line:21,address:0x6003,size:1},
  {path:'src/helpers.s',line:4,address:0x7000,size:2},
 ]);
 const stepped=await client.stepOverSource(map,{maxInstructions:8});
 assert.equal(stepped.reason,'source-location');
 assert.equal(stepped.instructions,3);
 assert.equal(stepped.steppedOverCall,true);
 assert.equal(stepped.state.pc,0x6003);
 assert.deepEqual(requests.map(request=>request.method),['state','readMemory','stepInstruction','stepInstruction','stepInstruction']);
});

test('source stepping reports unmapped code, machine stops, and instruction limits',async()=>{
 const unmapped=new EmulatorClient(async request=>({version:1,ok:true,result:request.method==='state'?execution(0x4000):execution(0x4001)}));
 const empty=sourceMapFor([]);
 assert.deepEqual((await unmapped.stepSource(empty)).reason,'unmapped');

 const stopped=new EmulatorClient(async request=>({version:1,ok:true,result:request.method==='state'
  ?execution(0x6000):execution(0x6000,0xff,{stopReason:'cpu-stopped'})}));
 const map=sourceMapFor([{path:'src/main.s',line:1,address:0x6000,size:1}]);
 assert.equal((await stopped.stepSource(map)).reason,'cpu-stopped');

 const looping=new EmulatorClient(async request=>({version:1,ok:true,result:request.method==='state'?execution(0x6000):execution(0x6000)}));
 const limited=await looping.stepSource(map,{maxInstructions:2});
 assert.equal(limited.reason,'instruction-limit');
 assert.equal(limited.instructions,2);
});

test('source stepping requires a stopped instruction boundary',async()=>{
 const map=sourceMapFor([]);
 for(const current of [execution(0x6000,0xff,{running:true,stopReason:'running'}),execution(0x6000,0xff,{instructionBoundary:false})]){
  const client=new EmulatorClient(async()=>({version:1,ok:true,result:current}));
  await assert.rejects(client.stepSource(map),/Pause|instruction boundary/);
 }
});

test('load-plan launch enters source through ROM input before starting execution',async()=>{
 const stopped={...state,running:false,stopReason:'cycle-limit',instructionBoundary:true};
 const running={...stopped,running:true,stopReason:'running'};
 const requests=[];
 const client=new EmulatorClient(async request=>{
  requests.push(request);
  return {version:1,ok:true,result:request.method==='run'?running:stopped};
 });
 await client.launchLoadPlan({format:'clementina-load-plan',version:1,steps:[
  {kind:'mia',path:'A.BIN',address:256,length:1},
  {kind:'prg',path:'G.PRG',loadAddress:24576,length:1,runAddress:24576},
 ]},{bootCycles:10,inputCycles:20,inputChunkBytes:64});
 assert.deepEqual(requests.map(r=>r.method),['reset','step','input','step','input','step','input','run']);
 assert.deepEqual(requests.filter(r=>r.method==='input').map(r=>String.fromCharCode(...r.data)),[
  '10 MIALOAD "A.BIN",256,1\r','20 BLOAD "G.PRG",24576\r','RUN\r',
 ]);
 await assert.rejects(client.launchLoadPlan({format:'clementina-load-plan',version:1,steps:[]}),/fewer than 1|terminal/i);
});
