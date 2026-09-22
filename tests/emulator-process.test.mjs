import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdtemp, realpath, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startEmulatorProcess, EmulatorProcessError} from '../packages/emulator-client/dist/node.js';

test('Node emulator lifecycle mounts the SD root, verifies readiness, and closes once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-emulator-process-'));
  const mountedRoot = await realpath(root);
  const executable = join(root, 'fake-emulator.mjs');
  await writeFile(executable, `#!/usr/bin/env node
const args=process.argv.slice(2),sd=args[args.indexOf('-sd')+1],port=Number(args[args.indexOf('-port')+1]);
if(sd!==${JSON.stringify(mountedRoot)})process.exit(9);
console.log('http://127.0.0.1:'+(port||12345)+'/v1');
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},1000);
`);
  await chmod(executable, 0o755);
  const requests = [];
  const fetcher = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({version: 1, ok: true, result: {version: 1, methods: ['capabilities'], maxCycles: 10000000, maxRead: 65536}});
  };
  const process = await startEmulatorProcess({executable, sdRoot: root, startupTimeoutMs: 5000, fetcher});
  assert.match(process.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.ok(process.pid > 0);
  assert.equal((await process.client.capabilities()).version, 1);
  assert.deepEqual(requests.map(request => request.method), ['capabilities', 'capabilities']);
  const [first, second] = await Promise.all([process.close(), process.close()]);
  assert.deepEqual(first, second);
  assert.equal(first.code, 0);
});

test('Node emulator lifecycle reports spawn and endpoint failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clementina-emulator-failure-'));
  await assert.rejects(startEmulatorProcess({executable: join(root, 'missing'), sdRoot: root, startupTimeoutMs: 100}), EmulatorProcessError);
  const executable = join(root, 'bad-emulator.mjs');
  await writeFile(executable, '#!/usr/bin/env node\nconsole.log("https://example.com/v1")\nsetInterval(()=>{},1000)\n');
  await chmod(executable, 0o755);
  await assert.rejects(startEmulatorProcess({executable, sdRoot: root, startupTimeoutMs: 1000}), /endpoint must be/);
  const silent = join(root, 'silent-emulator.mjs');
  await writeFile(silent, '#!/usr/bin/env node\nconsole.log("http://127.0.0.1:12345/v1")\nprocess.on("SIGTERM",()=>process.exit(0))\nsetInterval(()=>{},1000)\n');
  await chmod(silent, 0o755);
  await assert.rejects(startEmulatorProcess({
    executable: silent, sdRoot: root, startupTimeoutMs: 100,
    fetcher: async () => new Promise(() => {}),
  }), /readiness timed out/);
});
