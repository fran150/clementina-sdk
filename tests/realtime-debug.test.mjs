import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EmulatorClient} from '../packages/emulator-client/dist/index.js';
import {findInstalledTool, resolveEmulatorExecutable, startEmulatorProcess} from '../packages/emulator-client/dist/node.js';
import {ClementinaBasicDebugSession, ClementinaDebugSession, ClementinaProjectDebugSession} from '../packages/debug/dist/index.js';
import {basicRuntimeDebug} from '../packages/basic/dist/index.js';

const HOOK = basicRuntimeDebug.lineStartAddress;
const machineState = (overrides = {}) => ({
  cycles: '12', pc: 0x6000, a: 1, x: 2, y: 3, sp: 0xff, p: 0x24, paused: false,
  running: false, stopReason: 'breakpoint', instructionBoundary: true, ...overrides,
});
const sourceMap = entries => ({
  locationsForSource: (path, line) => entries.filter(entry => entry.path === path && entry.line === line),
  locationsForAddress: address => entries.filter(entry => address >= entry.address && address < entry.address + entry.size),
});

/** A fake emulator: breakpoints, a line filter, CURLIN and a scripted list of stops. */
function fakeEmulator({stops = [], line = 10, methods = ['setBreakpointFilter']} = {}) {
  const emulator = {active: [], filter: undefined, requests: [], line, state: machineState({stopReason: 'reset'})};
  emulator.client = new EmulatorClient(async request => {
    emulator.requests.push(request);
    const ok = result => ({version: 1, ok: true, result});
    switch (request.method) {
      case 'capabilities': return ok({version: 1, methods, maxCycles: 10000000, maxRead: 65536});
      case 'breakpoints': return ok([...emulator.active]);
      case 'bankBreakpoints': return ok([]);
      case 'addBreakpoint': if (!emulator.active.includes(request.address)) emulator.active.push(request.address); return ok([...emulator.active]);
      case 'removeBreakpoint': emulator.active = emulator.active.filter(address => address !== request.address); return ok([...emulator.active]);
      case 'setBreakpointFilter': emulator.filter = {address: request.address, watch: request.watch, values: request.values}; return ok(emulator.state);
      case 'clearBreakpointFilter': emulator.filter = undefined; return ok(emulator.state);
      case 'readMemory': return ok(request.address === basicRuntimeDebug.currentLineAddress ? [emulator.line & 255, emulator.line >> 8] : Array(request.count).fill(0xea));
      case 'state': return ok(emulator.state);
      case 'stackTrace': return ok({callers: [], unknownCaller: true});
      case 'resume': case 'run': {
        const next = stops.shift();
        if (next) { emulator.line = next.line ?? emulator.line; emulator.state = machineState(next.state); }
        return ok(machineState({running: true, stopReason: 'running'}));
      }
      case 'pause': emulator.state = machineState({stopReason: 'pause', pc: emulator.state.pc}); return ok(emulator.state);
      case 'stepInstruction': { const next = stops.shift(); emulator.state = machineState(next?.state ?? {stopReason: 'instruction'}); return ok(emulator.state); }
      default: throw new Error(`unexpected ${request.method}`);
    }
  });
  return emulator;
}

function projectSession(emulator) {
  const basic = new ClementinaBasicDebugSession(emulator.client, '/project/src/main.cbas', '10 PRINT "A"\n20 SYS 28672\n30 GOTO 10\n', undefined, ['src/main.cbas']);
  const assembly = new ClementinaDebugSession(emulator.client, sourceMap([{path: 'src/hello.s', line: 4, address: 0x7000, size: 2}, {path: 'src/hello.s', line: 5, address: 0x7002, size: 1}]));
  return new ClementinaProjectDebugSession(basic, assembly);
}

test('BASIC line breakpoints install an emulator line filter, lifted while stepping', async () => {
  const emulator = fakeEmulator({stops: [{line: 20, state: {pc: HOOK}}]});
  const basic = new ClementinaBasicDebugSession(emulator.client, '/project/src/main.cbas', '10 PRINT "A"\n20 END\n', undefined, ['src/main.cbas']);
  const [breakpoint] = await basic.setSourceBreakpoints('src/main.cbas', [1]);
  assert.equal(breakpoint.verified, true, 'a project-relative path names the BASIC entry');
  assert.deepEqual(emulator.filter, {address: HOOK, watch: basicRuntimeDebug.currentLineAddress, values: [10]});
  const stepped = await basic.stepIn({timeoutMs: 1000, pollIntervalMs: 1});
  assert.equal(stepped.reason, 'source-location');
  const clearIndex = emulator.requests.findIndex(request => request.method === 'clearBreakpointFilter');
  const resumeIndex = emulator.requests.findIndex(request => request.method === 'resume');
  assert.ok(clearIndex >= 0 && clearIndex < resumeIndex, 'the filter is lifted before the step resumes');
  assert.deepEqual(emulator.filter?.values, [10], 'and comes back after it');
  await basic.dispose();
  assert.equal(emulator.filter, undefined);
  assert.deepEqual(emulator.active, []);
});

test('BASIC sessions fall back to host-side line filtering on an emulator without filters', async () => {
  const emulator = fakeEmulator({methods: []});
  const basic = new ClementinaBasicDebugSession(emulator.client, '/project/main.cbas', '10 END\n');
  await basic.setSourceBreakpoints('/project/main.cbas', [1]);
  assert.equal(emulator.filter, undefined);
  assert.ok(!emulator.requests.some(request => request.method === 'setBreakpointFilter'));
  await basic.dispose();
});

test('a project session takes BASIC and assembly breakpoints together', async () => {
  const emulator = fakeEmulator({stops: [{state: {pc: 0x7000}}, {line: 30, state: {pc: HOOK}}]});
  const session = projectSession(emulator);
  const [asm] = await session.setSourceBreakpoints('src/hello.s', [4]);
  const [basic] = await session.setSourceBreakpoints('src/main.cbas', [3]);
  assert.equal(asm.verified, true);
  assert.equal(basic.verified, true);
  assert.deepEqual(emulator.active.sort(), [0x7000, HOOK].sort());

  await session.continue();
  let stopped = await session.waitForStop({timeoutMs: 1000, pollIntervalMs: 1});
  assert.deepEqual(stopped.frame.source, {path: 'src/hello.s', line: 4});
  const stack = await session.stackTrace();
  assert.deepEqual(stack.frames.map(frame => frame.source), [{path: 'src/hello.s', line: 4}, {path: '/project/src/main.cbas', line: 1}]);
  assert.match(stack.frames.at(-1).name, /\(BASIC\)$/);

  await session.continue();
  stopped = await session.waitForStop({timeoutMs: 1000, pollIntervalMs: 1});
  assert.deepEqual(stopped.frame.source, {path: '/project/src/main.cbas', line: 3});
  await session.dispose();
  assert.deepEqual(emulator.active, []);
});

test('stepping out of an assembly routine carries on to the next BASIC statement', async () => {
  const emulator = fakeEmulator({line: 20, stops: [
    {state: {pc: 0xe000, stopReason: 'instruction'}}, // RTS lands in the ROM
    {line: 30, state: {pc: HOOK}},                    // next BASIC statement
  ]});
  emulator.state = machineState({pc: 0x7002, stopReason: 'breakpoint'});
  const session = projectSession(emulator);
  const stepped = await session.next({timeoutMs: 1000, pollIntervalMs: 1});
  assert.equal(stepped.reason, 'source-location');
  assert.deepEqual(stepped.locations.map(location => [location.path, location.line]), [['/project/src/main.cbas', 3]]);
  await session.dispose();
});

test('installed tools are found in the Clementina home before PATH', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const env = {CLEMENTINA_HOME: home};
  assert.equal(findInstalledTool('clementina-emulator', env, 'linux'), 'clementina-emulator');
  await mkdir(join(home, 'bin'));
  await writeFile(join(home, 'bin', 'clementina-emulator'), '');
  await writeFile(join(home, 'bin', 'clementina-automation.exe'), '');
  assert.equal(findInstalledTool('clementina-emulator', env, 'linux'), join(home, 'bin', 'clementina-emulator'));
  assert.equal(findInstalledTool('clementina-automation', env, 'win32'), join(home, 'bin', 'clementina-automation.exe'));
  assert.equal(resolveEmulatorExecutable(undefined, {...env, CLEMENTINA_EMULATOR: '/x/emu'}), '/x/emu');
});

test('a real-time process starts the headless emulator paused with its control port', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clementina-rt-'));
  const sd = join(dir, 'sd');
  await mkdir(sd);
  const argsFile = join(dir, 'args.json');
  const fake = join(dir, 'fake-emulator.mjs');
  await writeFile(fake, `#!/usr/bin/env node
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({version: 1, ok: true, result: {version: 1, methods: ['capabilities'], maxCycles: 10000000, maxRead: 65536}}));
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port + '/v1'));
process.on('SIGTERM', () => process.exit(0));
`);
  await chmod(fake, 0o755);
  const started = await startEmulatorProcess({executable: fake, sdRoot: sd, realtime: {speedMhz: 2.5}});
  await started.close();
  const {realpath, readFile} = await import('node:fs/promises');
  const args = JSON.parse(await readFile(argsFile, 'utf8'));
  assert.deepEqual(args, ['--headless', '--control', '--paused', '--sd', await realpath(sd), '--control-port', '0', '--speed', '2.5']);
  await assert.rejects(startEmulatorProcess({executable: fake, sdRoot: sd, realtime: {speedMhz: 500}}), RangeError);
});

test('the emulator client validates speed and filter requests', async () => {
  const requests = [];
  const client = new EmulatorClient(async request => {
    requests.push(request);
    return {version: 1, ok: true, result: request.method.endsWith('peed') ? {realtime: true, targetMHz: 4, unthrottled: false, measuredMHz: 3.9} : machineState()};
  });
  assert.deepEqual(await client.setSpeed(4), {realtime: true, targetMHz: 4, unthrottled: false, measuredMHz: 3.9});
  assert.throws(() => client.setSpeed(-1), RangeError);
  await client.setBreakpointFilter(HOOK, basicRuntimeDebug.currentLineAddress, [10, 10, 20]);
  assert.deepEqual(requests.at(-1), {version: 1, method: 'setBreakpointFilter', address: HOOK, watch: basicRuntimeDebug.currentLineAddress, values: [10, 20]});
  assert.throws(() => client.setBreakpointFilter(HOOK, 0x41, []), RangeError);
});
