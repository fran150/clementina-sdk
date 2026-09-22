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
