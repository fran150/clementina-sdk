import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DebugClient} from '@vscode/debugadapter-testsupport';

const binPath = new URL('../packages/debug-adapter/bin/clementina-debug-adapter.mjs', import.meta.url).pathname;

async function basicProjectFixture() {
  const root = await mkdtemp(join(tmpdir(), 'clementina-debug-adapter-'));
  await writeFile(join(root, 'main.bas'), '10 PRINT "HI"\n20 END\n');
  await writeFile(join(root, 'clementina.yaml'), [
    'format: clementina-project', 'version: 1', 'name: Adapter Test',
    'target:', '  machine: clementina-6502',
    'program:', '  kind: basic', '  entry: main.bas',
    'assets:', '  palettes: []', '  paletteConfigs: []',
    '  tilesets: []', '  shapes: []', '  animations: []',
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
  } finally {
    await dc.stop();
  }
});

test('launching a BASIC project surfaces the real debug.program-kind rejection as a DAP error, not a crash', async () => {
  const root = await basicProjectFixture();
  const dc = new DebugClient(process.execPath, binPath, 'clementina');
  await dc.start();
  try {
    await dc.initializeRequest();
    await assert.rejects(
      dc.launchRequest({program: root}),
      /The current source debugger requires an assembly project and ld65 debug records/,
    );
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
