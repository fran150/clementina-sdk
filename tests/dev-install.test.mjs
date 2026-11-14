import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
  const bin = join(home, '.clementina', 'dev', 'bin');
  const env = {...process.env, HOME: home, CLEMENTINA_DEV_BIN: ''};
  const install = spawnSync(process.execPath, [join(root, 'scripts', 'dev-install.mjs')], {encoding: 'utf8', env});
  assert.equal(install.status, 0, install.stderr);
  const launched = spawnSync(join(bin, 'clementina'), ['--version'], {encoding: 'utf8'});
  assert.equal(launched.status, 0, launched.stderr);
  assert.match(launched.stdout, /dev build/u);
  assert.equal(await readFile(join(home, '.clementina', 'dev', 'clementina-dev.sh'), 'utf8'),
    await readFile(join(root, 'scripts', 'clementina-dev.sh'), 'utf8'));

  // The shell switch puts the folder first once, however often it runs, and removes it again.
  const script = `. "$HOME/.clementina/dev/clementina-dev.sh"
clementina-dev on >/dev/null; clementina-dev on >/dev/null
printf '%s\\n' "$PATH" | tr ':' '\\n' | grep -cxF "${bin}"
clementina-dev status | grep '^clementina:'
clementina-dev off >/dev/null
printf '%s\\n' "$PATH" | tr ':' '\\n' | grep -cxF "${bin}" || true`;
  const shell = spawnSync('bash', ['-c', script], {encoding: 'utf8', env: {...env, PATH: `/usr/bin:/bin:${process.env.PATH}`}});
  assert.equal(shell.status, 0, shell.stderr);
  assert.deepEqual(shell.stdout.trim().split('\n'), ['1', `clementina: dev, ${join(bin, 'clementina')}`, '0']);
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
