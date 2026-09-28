import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DebugClient} from '@vscode/debugadapter-testsupport';
import {ClementinaDebugAdapter} from '../packages/debug-adapter/dist/adapter.js';

const binPath = new URL('../packages/debug-adapter/bin/clementina-debug-adapter.mjs', import.meta.url).pathname;

async function basicProjectFixture() {
  const root = await mkdtemp(join(tmpdir(), 'clementina-debug-adapter-'));
  await writeFile(join(root, 'main.bas'), '10 PRINT "HI"\n20 END\n');
  await writeFile(join(root, 'clementina.yaml'), [
    'format: clementina-project', 'version: 1', 'name: Adapter Test',
    'target:', '  machine: clementina-6502',
    'program:', '  kind: basic', '  entry: main.bas',
    'assets:', '  palettes: []', '  paletteConfigs: []',
    '  tilesets: []', '  backgrounds: []', '  overlays: []', '  shapes: []', '  animations: []',
    'build:', '  outputDirectory: build', '  basic:', '    outputName: game', '',
  ].join('\n'));
  return root;
}

test('the stdio DAP server declares only the capabilities it actually supports', async () => {
  const dc = new DebugClient(process.execPath, binPath, 'clementina');
  await dc.start();
  try {
    const response = await dc.initializeRequest();
    assert.equal(response.body.supportsConfigurationDoneRequest, true);
    assert.equal(response.body.supportsDisassembleRequest, true);
  } finally {
    await dc.stop();
  }
});

test('launching a BASIC project reaches emulator startup instead of rejecting its program kind', async () => {
  const root = await basicProjectFixture();
  const dc = new DebugClient(process.execPath, binPath, 'clementina');
  await dc.start();
  try {
    await dc.initializeRequest();
    await assert.rejects(dc.launchRequest({program: root, emulator: '/definitely/missing/clementina-automation'}), error => {
      assert.doesNotMatch(String(error), /requires an assembly project|program-kind/u);
      assert.match(String(error), /ENOENT|spawn|executable|No such file/u);
      return true;
    });
  } finally {
    await dc.stop();
  }
});

test('disconnect is safe when no session was ever launched', async () => {
  const dc = new DebugClient(process.execPath, binPath, 'clementina');
  await dc.start();
  try {
    await dc.initializeRequest();
    const response = await dc.disconnectRequest();
    assert.equal(response.success, true);
  } finally {
    await dc.stop();
  }
});

test('DAP translates verified callers and banked disassembly from the shared session', async () => {
  const adapter = new ClementinaDebugAdapter();
  const responses=[];
  adapter.sendResponse = response => responses.push(response);
  const leaf={id:1,name:'bank2.s:7',instructionPointer:0x8000,bank:2,source:{path:'bank2.s',line:7},locations:[]};
  const caller={id:2,name:'main.s:10 (call)',instructionPointer:0x6003,bank:2,source:{path:'main.s',line:10},locations:[]};
  const session={
    snapshot:async()=>({frame:leaf}),
    stackTrace:async()=>({frames:[leaf,caller],unknownCaller:true}),
    disassemble:async(address,count,bank)=>{
      assert.deepEqual([address,count,bank],[0x8000,1,2]);
      return [{address:0x8000,bank:2,bytes:[0x20,0x03,0x60],text:'JSR $6003',source:{path:'bank2.s',line:7}}];
    },
  };
  adapter.createSession=async()=>({ok:true,value:{session}});
  await adapter.launchRequest({command:'launch',request_seq:1,success:true}, {program:'/tmp/project'});
  const stackResponse={command:'stackTrace',request_seq:2,success:true};
  await adapter.stackTraceRequest(stackResponse);
  assert.deepEqual(stackResponse.body.stackFrames.map(frame=>frame.name),['bank2.s:7','main.s:10 (call)','Unknown caller (unverified stack)']);
  assert.equal(stackResponse.body.stackFrames[0].instructionPointerReference,'0x8000@2');
  const disassemblyResponse={command:'disassemble',request_seq:3,success:true};
  await adapter.disassembleRequest(disassemblyResponse,{memoryReference:'0x8000@2',instructionCount:1});
  assert.deepEqual(disassemblyResponse.body.instructions,[{
    address:'0x8000',instructionBytes:'20 03 60',instruction:'JSR $6003',location:disassemblyResponse.body.instructions[0].location,line:7,
  }]);
  assert.equal(disassemblyResponse.body.instructions[0].location.path,'bank2.s');
  assert.equal(responses.length,3);
});
test('DAP resolves absolute assembly breakpoint paths against the project root', async () => {
  const root='/tmp/clementina-adapter-project', observed=[];
  const adapter=new ClementinaDebugAdapter();
  adapter.sendResponse=()=>{};
  adapter.createSession=async()=>({ok:true,value:{session:{setSourceBreakpoints:async(path,lines)=>{
    observed.push([path,lines]);
    return [{path,requestedLine:7,verified:true,line:7,addresses:[0x6000]}];
  }}}});
  await adapter.launchRequest({command:'launch',request_seq:1,success:true},{program:root});
  const source=join(root,'src/main.s');
  const response={command:'setBreakpoints',request_seq:2,success:true};
  await adapter.setBreakPointsRequest(response,{source:{path:source},breakpoints:[{line:7}]});
  assert.deepEqual(observed,[['src/main.s',[7]]]);
  assert.equal(response.body.breakpoints[0].source.path,source);
});
test('DAP closes a session prepared after disconnect', async () => {
  let finish,closeCalls=0;
  const pending=new Promise(resolve=>{finish=resolve});
  const adapter=new ClementinaDebugAdapter();
  adapter.sendResponse=()=>{};
  adapter.sendErrorResponse=()=>{};
  adapter.createSession=()=>pending;
  const launching=adapter.launchRequest({command:'launch',request_seq:1,success:true},{program:'/tmp/project'});
  await adapter.disconnectRequest({command:'disconnect',request_seq:2,success:true});
  finish({ok:true,value:{close:async()=>{closeCalls++}}});
  await launching;
  assert.equal(closeCalls,1);
});
test('DAP reports launch failures and closes the owned session', async () => {
  let finishClose,closeCalls=0;
  const closed=new Promise(resolve=>{finishClose=resolve});
  const events=[];
  const adapter=new ClementinaDebugAdapter();
  adapter.sendResponse=()=>{};
  adapter.sendEvent=event=>events.push(event);
  adapter.createSession=async()=>({ok:true,value:{launch:async()=>{throw new Error('emulator launch failed')},close:async()=>{closeCalls++;finishClose()}}});
  await adapter.launchRequest({command:'launch',request_seq:1,success:true},{program:'/tmp/project'});
  adapter.configurationDoneRequest({command:'configurationDone',request_seq:2,success:true});
  await closed;
  assert.equal(closeCalls,1);
  assert.ok(events.some(event=>event.event==='output'&&/emulator launch failed/.test(event.body.output)));
  assert.ok(events.some(event=>event.event==='terminated'));
});
