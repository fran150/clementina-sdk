import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {verifyCode} from '../agents/workflows/code-game.mjs';
import {checkCharacter} from '../agents/workflows/create-character.mjs';
import {inspectBreakpoint} from '../agents/workflows/debug-game.mjs';

const sdkRoot = resolve(import.meta.dirname, '..');

test('code workflow checks CPU memory after a real SDK build and closes its emulator', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-code-'));
  const root = join(temporary, 'game');
  let closed = 0;
  try {
    await cp(join(sdkRoot, 'templates/basic-game'), root, {recursive: true});
    await rm(join(root, 'checks/smoke.json'));
    await writeFile(join(root, 'checks/code.json'), JSON.stringify({
      format: 'clementina-code-check', version: 1, settleCycles: 10,
      memory: [{address: 512, bytes: [42]}],
    }));
    const fake = {
      client: {
        launchLoadPlan: async () => ({}), pause: async () => ({}),
        step: async () => ({pc: 0x1234, cycles: '10'}),
        video: async () => {
          const image = Buffer.alloc(68944);
          image.set(await readFile(join(root, 'build/asset-palette.bin')), 256);
          return [...image];
        },
        readMemory: async () => [42],
      },
      close: async () => {closed++;},
    };
    const result = await verifyCode(root, {}, {startEmulatorProcess: async () => fake});
    assert.equal(result.report.checks.memory[0].found, true);
    assert.equal(result.report.before.state.pc, 0x1234);
    assert.equal(closed, 1);
    const report = JSON.parse(await readFile(join(root, 'build/inspection/report.json'), 'utf8'));
    assert.equal(report.checks.memory[0].observed[0], 42);
    fake.client.readMemory = async () => [41];
    await assert.rejects(verifyCode(root, {}, {startEmulatorProcess: async () => fake}), /Smoke inspection failed/);
    assert.equal(closed, 2);
  } finally { await rm(temporary, {recursive: true, force: true}); }
});

test('debug workflow records a verified source stop and closes the owned session', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-debug-workflow-'));
  const root = join(temporary, 'game');
  let closed = 0, breakpointPath;
  try {
    await cp(join(sdkRoot, 'templates/basic-game'), root, {recursive: true});
    const result = await inspectBreakpoint(root, {line: 2, memory: {address: 512, count: 1}}, {
      createProjectDebugSession: async () => ({ok: true, diagnostics: [], value: {
        build: {kind: 'basic', files: [{kind: 'load-plan', path: 'build/load-plan.json'}]},
        endpoint: 'http://127.0.0.1:1/v1',
        session: {
          setSourceBreakpoints: async (path) => {breakpointPath = path; return [{verified: true, addresses: [0x1234]}];},
          waitForStop: async () => ({state: {stopReason: 'breakpoint', pc: 0x1234},
            frame: {name: 'main.bas:2', source: {path: breakpointPath, line: 2}}}),
          readMemory: async () => [42],
        },
        launch: async () => ({}), close: async () => {closed++;},
      }}),
      createHttpEmulatorClient: () => ({video: async () => Array(68944).fill(0)}),
    });
    assert.ok(breakpointPath.endsWith('/src/main.bas'));
    assert.equal(result.report.memory.bytes[0], 42);
    assert.equal(result.report.video.bytes, 68944);
    assert.equal(closed, 1);
    assert.equal((await readFile(join(root, 'build/inspection/debug.video.bin'))).length, 68944);
  } finally { await rm(temporary, {recursive: true, force: true}); }
});

test('character workflow validates portable references against emulator OAM evidence', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-character-'));
  const root = join(temporary, 'demo');
  try {
    await cp(join(sdkRoot, 'examples/runtime-demo'), root, {recursive: true});
    await mkdir(join(root, 'build/inspection'), {recursive: true});
    const video = Buffer.alloc(68944);
    video[0x20] = 1;
    video[0x21] = 4;
    video.set([0, 36, 32, 0, 0], 67664);
    await writeFile(join(root, 'build/inspection/debug.video.bin'), video);
    const checked = await checkCharacter(root);
    assert.equal(checked.report.matches, true);
    assert.deepEqual(checked.report.expected[0], [0, 36, 32, 0, 0]);
    video[67665] = 35;
    await writeFile(join(root, 'build/inspection/debug.video.bin'), video);
    await assert.rejects(checkCharacter(root), /Character OAM mismatch/);
  } finally { await rm(temporary, {recursive: true, force: true}); }
});
