import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readlink, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const cli = new URL('../packages/cli/bin/clementina.mjs', import.meta.url).pathname;

test('--version names the checkout build and its commit', () => {
  const result = spawnSync(process.execPath, [cli, '--version', '--json'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const {data, message} = JSON.parse(result.stdout);
  const commit = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).stdout.trim();
  assert.equal(data.source, 'checkout');
  assert.equal(data.commit, commit);
  assert.match(message, new RegExp(`^clementina \\S+ \\(dev build, commit ${commit}`));
});

test('dev install writes launchers that run this checkout', {skip: process.platform === 'win32'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-dev-'));
  const env = {...process.env, CLEMENTINA_HOME: home, CLEMENTINA_DEV_BIN: ''};
  const install = spawnSync(process.execPath, [join(root, 'scripts', 'dev-install.mjs')], {encoding: 'utf8', env});
  assert.equal(install.status, 0, install.stderr);
  const launched = spawnSync(join(home, 'dev', 'bin', 'clementina'), ['--version'], {encoding: 'utf8'});
  assert.equal(launched.status, 0, launched.stderr);
  assert.match(launched.stdout, /dev build/u);
});

test('dev on and off switch bin/ and the CLI between dev builds and the installed tools', {skip: process.platform === 'win32'}, async () => {
  const {devLaunch, devNotice, runDevBuild} = await import('../packages/cli/dist/dev.js');
  const {useInstalledTools} = await import('../packages/cli/dist/install.js');
  const home = await mkdtemp(join(tmpdir(), 'clementina-dev-'));
  const env = {...process.env, CLEMENTINA_HOME: home, CLEMENTINA_DEV_BIN: '', CLEMENTINA_DEV_FORWARDED: ''};
  const run = args => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', env});
  const devBin = join(home, 'dev', 'bin');

  // With no dev builds there is nothing to switch to.
  const empty = run(['dev', 'on', '--json']);
  assert.equal(empty.status, 1);
  assert.equal(JSON.parse(empty.stdout).diagnostics[0].code, 'dev.empty');

  // An installed emulator, linked from bin/, and dev builds of the CLI and the emulator.
  const release = join(home, 'tools', 'emulator', 'clementina-automation');
  await mkdir(dirname(release), {recursive: true});
  await writeFile(release, '#!/bin/sh\necho release\n', {mode: 0o755});
  await mkdir(join(home, 'bin'), {recursive: true});
  await symlink(release, join(home, 'bin', 'clementina-automation'));
  await writeFile(join(home, 'installed.json'), JSON.stringify({version: 1, tools: {emulator: {
    tool: 'emulator', tag: 'v1.0.0', asset: 'emulator.tar.gz', location: dirname(release), commands: ['clementina-automation']}}}));
  assert.equal(spawnSync(process.execPath, [join(root, 'scripts', 'dev-install.mjs')], {env}).status, 0);
  await writeFile(join(devBin, 'clementina-automation'), '#!/bin/sh\necho dev\n', {mode: 0o755});

  const on = run(['dev', 'on']);
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /Dev mode is on/u);
  assert.equal(await readlink(join(home, 'bin', 'clementina-automation')), join(devBin, 'clementina-automation'));
  assert.equal(await readlink(join(home, 'bin', 'clementina-mcp')), join(devBin, 'clementina-mcp'));
  assert.match(run(['dev']).stdout, /Dev mode is on/u);
  assert.match(run(['doctor']).stdout, /dev mode: on/u);
  assert.match(devNotice(['build'], env), /dev mode is on/u);
  assert.equal(devNotice(['build', '--json'], env), undefined);
  assert.equal(devNotice(['dev', 'off'], env), undefined);

  // The installed standalone CLI runs the dev build, except for dev and update.
  const launch = devLaunch(['--version'], env, true);
  assert.equal(launch.command, join(devBin, 'clementina'));
  assert.equal(devLaunch(['dev', 'off'], env, true), undefined);
  assert.equal(devLaunch(['update'], env, true), undefined);
  assert.equal(devLaunch(['--version'], env, false), undefined);
  assert.equal(devLaunch(['--version'], {...env, CLEMENTINA_DEV_FORWARDED: '1'}, true), undefined);
  assert.equal(await runDevBuild({command: join(devBin, 'clementina'), args: ['project', 'validate', '/nonexistent']}, env), 1);
  const path = {...env, PATH: '/usr/bin'};
  useInstalledTools(path);
  assert.equal(path.PATH.split(':')[0], devBin);

  const off = run(['dev', 'off']);
  assert.equal(off.status, 0, off.stderr);
  assert.equal(await readlink(join(home, 'bin', 'clementina-automation')), release);
  await assert.rejects(lstat(join(home, 'bin', 'clementina-mcp')));
  assert.equal(devNotice(['build'], env), undefined);
  assert.match(run(['dev', 'status']).stdout, /Dev mode is off/u);
});

test('clementina mcp serves the MCP server over stdio', async () => {
  const {spawn} = await import('node:child_process');
  const child = spawn(process.execPath, [cli, 'mcp'], {stdio: ['pipe', 'pipe', 'inherit']});
  let output = '';
  const answered = new Promise(resolve => child.stdout.on('data', chunk => {
    output += chunk;
    if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0]));
  }));
  child.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}}}) + '\n');
  const response = await answered;
  child.stdin.end();
  await new Promise(resolve => child.on('exit', resolve));
  assert.equal(response.result.serverInfo.name, 'clementina-sdk');
});
