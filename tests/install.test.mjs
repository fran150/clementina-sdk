import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readlink, writeFile, chmod} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentPlatform, TOOL_RELEASES} from '../packages/cli/dist/install.js';

const cli = new URL('../packages/cli/bin/clementina.mjs', import.meta.url).pathname;
const platform = currentPlatform();
const target = platform && `${platform.os}-${platform.arch}`;

/** A release folder tree served like github.com/<repo>/releases/download/<tag>/. */
async function fakeReleases(root, {corrupt = false} = {}) {
  const files = new Map();
  async function release(tool, folder, executables) {
    const {repo, tag} = TOOL_RELEASES[tool];
    const work = await mkdtemp(join(tmpdir(), 'clementina-asset-'));
    const name = tool === 'cc65' ? `cc65-${tag.slice('cc65-v'.length)}-${target}` : `clementina-${tool}-${tag}-${target}`;
    const dir = join(work, name, folder);
    await mkdir(dir, {recursive: true});
    for (const executable of executables) {
      await writeFile(join(dir, executable), `#!/bin/sh\necho "${executable} fake"\n`);
      await chmod(join(dir, executable), 0o755);
    }
    spawnSync('tar', ['-czf', `${name}.tar.gz`, name], {cwd: work});
    const data = await readFile(join(work, `${name}.tar.gz`));
    const sum = createHash('sha256').update(corrupt ? 'other' : data).digest('hex');
    files.set(`/${repo}/releases/download/${tag}/${name}.tar.gz`, data);
    files.set(`/${repo}/releases/download/${tag}/SHA256SUMS`, Buffer.from(`${sum}  ${name}.tar.gz\n`));
  }
  await release('cc65', 'bin', ['ca65', 'ld65', 'ar65']);
  await release('emulator', '', ['clementina-emulator', 'clementina-automation']);
  const server = createServer((request, response) => {
    const body = files.get(request.url);
    response.writeHead(body ? 200 : 404).end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, base: `http://127.0.0.1:${server.address().port}`};
}

/** Run the CLI without blocking this process, which also serves the fake releases. */
function clementina(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {env: {...process.env, ...env}});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({status, stdout, stderr}));
  });
}

test('install downloads, verifies and links the tested releases', {skip: !platform || platform.os === 'windows'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const userHome = await mkdtemp(join(tmpdir(), 'clementina-user-'));
  const {server, base} = await fakeReleases();
  try {
    const env = {CLEMENTINA_HOME: home, CLEMENTINA_DOWNLOAD_BASE: base, HOME: userHome, SHELL: '/bin/bash'};
    const installed = await clementina(['install', 'cc65', 'emulator', '--json'], env);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const {data} = JSON.parse(installed.stdout);
    assert.deepEqual(data.installed.map(entry => entry.tool), ['cc65', 'emulator']);
    assert.equal(await readlink(join(home, 'bin', 'ca65')), join(home, 'tools', 'cc65', 'bin', 'ca65'));
    assert.equal(await readlink(join(home, 'bin', 'clementina-automation')), join(home, 'tools', 'emulator', 'clementina-automation'));
    // New shells get the bin folder once, however often install runs.
    const again = await clementina(['install', 'cc65', 'emulator', '--json'], env);
    assert.deepEqual(JSON.parse(again.stdout).data.current.map(entry => entry.tool), ['cc65', 'emulator']);
    const bashrc = await readFile(join(userHome, '.bashrc'), 'utf8');
    assert.equal(bashrc.match(/clementina install/gu)?.length, 1);
    assert.match(bashrc, /export PATH="\$HOME\/|export PATH="\//u);
    // Commands find installed tools even when the shell's PATH does not list them.
    const doctor = await clementina(['doctor', '--json'], {...env, PATH: '/nonexistent'});
    const tools = JSON.parse(doctor.stdout).data.tools;
    assert.equal(tools.ca65.path, join(home, 'bin', 'ca65'));
    assert.equal(tools.emulator.path, join(home, 'bin', 'clementina-automation'));
  } finally {
    server.close();
  }
});

test('install refuses a download that does not match SHA256SUMS', {skip: !platform || platform.os === 'windows'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const {server, base} = await fakeReleases(undefined, {corrupt: true});
  try {
    const result = await clementina(['install', 'emulator', '--no-modify-path', '--json'], {CLEMENTINA_HOME: home, CLEMENTINA_DOWNLOAD_BASE: base});
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'install.checksum');
  } finally {
    server.close();
  }
});

test('install rejects unknown tools', async () => {
  assert.equal((await clementina(['install', 'nothing'], {})).status, 2);
});
