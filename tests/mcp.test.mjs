import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const sdkRoot = resolve(import.meta.dirname, '..');
const server = join(sdkRoot, 'packages/mcp/bin/clementina-mcp.mjs');
const template = join(sdkRoot, 'templates/basic-game');
const data = result => result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);

test('MCP stdio server lists tools, validates assets/projects, builds, and returns structured failures', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-mcp-'));
  const root = join(temporary, 'project');
  const client = new Client({name: 'clementina-mcp-test', version: '1.0.0'});
  const transport = new StdioClientTransport({command: process.execPath, args: [server]});
  try {
    await cp(template, root, {recursive: true});
    await client.connect(transport);
    const listed = await client.listTools();
    for (const name of ['project_validate', 'asset_validate', 'project_build', 'emulator_launch',
      'emulator_stop', 'emulator_state', 'emulator_step', 'emulator_input', 'emulator_read_memory',
      'emulator_audio', 'emulator_video_snapshot']) {
      assert.ok(listed.tools.some(tool => tool.name === name), name);
    }
    const project = data(await client.callTool({name: 'project_validate', arguments: {projectRoot: root}}));
    assert.equal(project.ok, true);
    assert.equal(project.programKind, 'basic');
    const invalid = await client.callTool({name: 'asset_validate', arguments: {asset: {format: 'wrong'}}});
    assert.equal(invalid.isError, true);
    assert.equal(data(invalid).ok, false);
    const inactive = await client.callTool({name: 'emulator_state', arguments: {}});
    assert.equal(inactive.isError, true);
    const built = data(await client.callTool({name: 'project_build', arguments: {projectRoot: root}}));
    assert.equal(built.ok, true);
    assert.equal(built.kind, 'basic');
    assert.ok((await readFile(join(root, 'build/game.bas'))).length > 0);
    assert.equal(data(await client.callTool({name: 'emulator_stop', arguments: {}})).stopped, false);
  } finally {
    await client.close().catch(() => undefined);
    await rm(temporary, {recursive: true, force: true});
  }
});

test('MCP controls an owned emulator and captures native video', {skip: !process.env.CLEMENTINA_EMULATOR}, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clementina-mcp-emulator-'));
  const root = join(temporary, 'project');
  const client = new Client({name: 'clementina-mcp-emulator-test', version: '1.0.0'});
  const transport = new StdioClientTransport({command: process.execPath, args: [server]});
  try {
    await cp(join(sdkRoot, 'templates/asm-game'), root, {recursive: true});
    await client.connect(transport);
    const launched = await client.callTool({name: 'emulator_launch', arguments: {
      projectRoot: root, executable: process.env.CLEMENTINA_EMULATOR,
    }});
    assert.equal(launched.isError, undefined, JSON.stringify(data(launched)));
    assert.equal(data(launched).ok, true);
    const paused = data(await client.callTool({name: 'emulator_control', arguments: {action: 'pause'}}));
    assert.equal(paused.ok, true, JSON.stringify(paused));
    const stepped = data(await client.callTool({name: 'emulator_step', arguments: {cycles: 500000}}));
    assert.equal(stepped.ok, true, JSON.stringify(stepped));
    const memory = data(await client.callTool({name: 'emulator_read_memory', arguments: {address: 0x0200, count: 1}}));
    assert.deepEqual(memory.bytes, [42]);
    const video = data(await client.callTool({name: 'emulator_video_snapshot', arguments: {}}));
    assert.equal(video.bytes, 68944);
    assert.equal((await readFile(join(root, video.path))).length, 68944);
    assert.equal(data(await client.callTool({name: 'emulator_stop', arguments: {}})).stopped, true);
  } finally {
    await client.close().catch(() => undefined);
    await rm(temporary, {recursive: true, force: true});
  }
});
