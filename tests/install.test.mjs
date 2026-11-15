import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readlink, writeFile, chmod} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cliAssetName, currentPlatform, TOOL_REPOS, updateTools} from '../packages/cli/dist/install.js';

const cli = new URL('../packages/cli/bin/clementina.mjs', import.meta.url).pathname;
const platform = currentPlatform();
const target = platform && `${platform.os}-${platform.arch}`;

/** A release folder tree served like github.com/<repo>/releases/download/<tag>/. */
async function fakeReleases(root, {corrupt = false, limited = false} = {}) {
  const files = new Map();
  const releases = new Map();
  async function release(tool, tag, folder, executables) {
    const {repo} = TOOL_REPOS[tool];
    releases.set(repo, [...(releases.get(repo) ?? []), {tag_name: tag}]);
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
  // Newest first, as the GitHub API lists them; an SDK tag shares the cc65 repository.
  releases.set(TOOL_REPOS.cc65.repo, [{tag_name: 'v9.0.0'}, {tag_name: 'cc65-vnext', draft: true}]);
  await release('cc65', 'cc65-v2.19', 'bin', ['ca65', 'ld65', 'ar65']);
  await release('emulator', 'v0.5.0', '', ['clementina-emulator', 'clementina-automation']);
  await release('emulator', 'v0.4.0', '', ['clementina-emulator', 'clementina-automation']);
  // The newest SDK release carries a standalone CLI.
  const cliAsset = cliAssetName(platform);
  const cliData = Buffer.from('#!/bin/sh\necho "clementina 9.0.0"\n');
  files.set(`/${TOOL_REPOS.cc65.repo}/releases/download/v9.0.0/${cliAsset}`, cliData);
  files.set(`/${TOOL_REPOS.cc65.repo}/releases/download/v9.0.0/SHA256SUMS`,
    Buffer.from(`${createHash('sha256').update(cliData).digest('hex')}  ${cliAsset}\n`));
  const server = createServer((request, response) => {
    const [path] = request.url.split('?');
    const listed = path.match(/^\/api\/repos\/(.+)\/releases$/u);
    const feed = path.match(/^\/(.+)\/releases\.atom$/u);
    if (listed && limited) return response.writeHead(403).end('rate limited');
    const body = listed ? Buffer.from(JSON.stringify(releases.get(listed[1]) ?? []))
      : feed ? Buffer.from((releases.get(feed[1]) ?? []).filter(entry => !entry.draft)
        .map(entry => `<entry><link rel="alternate" type="text/html" href="https://github.com/${feed[1]}/releases/tag/${entry.tag_name}"/></entry>`).join(''))
      : files.get(path);
    response.writeHead(body ? 200 : 404).end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {server, base, env: {CLEMENTINA_DOWNLOAD_BASE: base, CLEMENTINA_API_BASE: `${base}/api`}};
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

test('install downloads, verifies and links the newest releases', {skip: !platform || platform.os === 'windows'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const userHome = await mkdtemp(join(tmpdir(), 'clementina-user-'));
  const {server, env: releaseEnv} = await fakeReleases();
  try {
    const env = {...releaseEnv, CLEMENTINA_HOME: home, HOME: userHome, SHELL: '/bin/bash'};
    const installed = await clementina(['install', 'cc65', 'emulator', '--json'], env);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const {data} = JSON.parse(installed.stdout);
    assert.deepEqual(data.installed.map(entry => [entry.tool, entry.tag]), [['cc65', 'cc65-v2.19'], ['emulator', 'v0.5.0']]);
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
    // A version picks that release instead of the newest.
    const older = await clementina(['install', 'emulator@0.4.0', '--json'], env);
    assert.deepEqual(JSON.parse(older.stdout).data.installed.map(entry => entry.tag), ['v0.4.0']);
    const missing = await clementina(['install', 'emulator@v9.9.9', '--json'], env);
    assert.equal(JSON.parse(missing.stdout).diagnostics[0].code, 'install.release');
  } finally {
    server.close();
  }
});

test('install finds the newest release in the releases feed when the API is rate limited', {skip: !platform || platform.os === 'windows'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const {server, env} = await fakeReleases(undefined, {limited: true});
  try {
    const result = await clementina(['install', 'cc65', 'emulator', '--no-modify-path', '--json'], {...env, CLEMENTINA_HOME: home});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).data.installed.map(entry => entry.tag), ['cc65-v2.19', 'v0.5.0']);
  } finally {
    server.close();
  }
});

test('install refuses a download that does not match SHA256SUMS', {skip: !platform || platform.os === 'windows'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const {server, env} = await fakeReleases(undefined, {corrupt: true});
  try {
    const result = await clementina(['install', 'emulator', '--no-modify-path', '--json'], {...env, CLEMENTINA_HOME: home});
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'install.checksum');
  } finally {
    server.close();
  }
});

test('install rejects unknown tools and malformed versions', async () => {
  for (const args of [['nothing'], ['emulator@'], ['emulator@1@2'], ['emulator', 'emulator@1']]) {
    assert.equal((await clementina(['install', ...args], {})).status, 2, args.join(' '));
  }
});

test('update --check lists newer releases without downloading them', {skip: !platform || platform.os === 'windows'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const {server, base} = await fakeReleases();
  try {
    const options = {home, downloadBase: base, apiBase: `${base}/api`};
    const old = await clementina(['install', 'emulator@0.4.0', '--no-modify-path'], {CLEMENTINA_HOME: home, CLEMENTINA_DOWNLOAD_BASE: base, CLEMENTINA_API_BASE: `${base}/api`});
    assert.equal(old.status, 0, old.stderr);
    const report = await updateTools({...options, check: true, cli: {version: '0.3.0-alpha.3', how: 'npm'}});
    assert.deepEqual(report.cli, {current: 'v0.3.0-alpha.3', latest: 'v9.0.0', updated: false, hint: 'npm install -g @clementina/cli@alpha'});
    assert.deepEqual(report.tools, [{tool: 'emulator', current: 'v0.4.0', latest: 'v0.5.0'}]);
    assert.deepEqual(report.installed, []);
    assert.equal(JSON.parse(await readFile(join(home, 'installed.json'), 'utf8')).tools.emulator.tag, 'v0.4.0');
  } finally {
    server.close();
  }
});

test('update replaces a standalone CLI and moves installed tools to their newest releases', {skip: !platform || platform.os === 'windows'}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'clementina-home-'));
  const {server, base} = await fakeReleases();
  try {
    const env = {CLEMENTINA_HOME: home, CLEMENTINA_DOWNLOAD_BASE: base, CLEMENTINA_API_BASE: `${base}/api`};
    assert.equal((await clementina(['install', 'emulator@0.4.0', 'cc65', '--no-modify-path'], env)).status, 0);
    const executable = join(home, 'bin', 'clementina');
    await writeFile(executable, 'old');
    const report = await updateTools({home, downloadBase: base, apiBase: `${base}/api`, check: false,
      cli: {version: '0.3.0-alpha.3', how: 'standalone', executable}});
    assert.equal(report.cli.updated, true);
    assert.match(await readFile(executable, 'utf8'), /clementina 9\.0\.0/u);
    // cc65 is already at its newest release; only the emulator moves.
    assert.deepEqual(report.installed.map(entry => [entry.tool, entry.tag]), [['emulator', 'v0.5.0']]);
    assert.equal(JSON.parse(await readFile(join(home, 'installed.json'), 'utf8')).tools.emulator.tag, 'v0.5.0');
  } finally {
    server.close();
  }
});

test('update rejects unknown tools', async () => {
  assert.equal((await clementina(['update', 'nothing'], {})).status, 2);
});
