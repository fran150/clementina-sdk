import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {checkAsset, type AssetKind} from '@clementina/assets';
import {buildProject} from '@clementina/build';
import {startEmulatorProcess, type EmulatorProcess} from '@clementina/emulator-client/node';
import {loadProject, resolveProjectPath} from '@clementina/project/node';

type Active = {root: string; process: EmulatorProcess; output: string};
type Data = Record<string, unknown>;
const reply = (data: Data, isError = false) => ({
  content: [{type: 'text' as const, text: JSON.stringify(data)}],
  structuredContent: data, ...(isError ? {isError: true} : {}),
});
const failure = (error: unknown) => reply({ok: false, error: error instanceof Error ? error.message : String(error)}, true);

/** One connection owns one emulator process; all mutating and machine calls are ordered. */
export function createClementinaMcpServer(): McpServer {
  const server = new McpServer({name: 'clementina-sdk', version: '0.2.0'});
  let active: Active | undefined;
  let tail: Promise<void> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const machine = <T>(op: (session: Active) => Promise<T>) => serial(async () => {
    if (!active) throw Error('No emulator session. Call emulator_launch first.');
    return op(active);
  });
  server.server.onclose = () => { void serial(async () => {
    const session = active; active = undefined;
    if (session) await session.process.close();
  }).catch(() => undefined); };

  server.registerTool('project_validate', {
    description: 'Validate a portable project, including asset references and program files.',
    inputSchema: z.object({projectRoot: z.string().min(1)}),
  }, async ({projectRoot}) => {
    try {
      const checked = await loadProject(resolve(projectRoot));
      return reply({ok: checked.ok, diagnostics: checked.diagnostics,
        ...(checked.ok ? {name: checked.value.manifest.name, programKind: checked.value.manifest.program.kind,
          assets: Object.fromEntries(Object.entries(checked.value.assets).map(([kind, items]) => [kind, items.length]))} : {})}, !checked.ok);
    } catch (error) { return failure(error); }
  });
  server.registerTool('asset_validate', {
    description: 'Validate an asset object; use project_validate for cross-asset references.',
    inputSchema: z.object({asset: z.unknown(), kind: z.enum(['palettes', 'paletteConfigs', 'tilesets',
      'backgrounds', 'overlays', 'shapes', 'animations', 'instruments', 'sounds', 'songs']).optional()}),
  }, async ({asset, kind}) => {
    try {
      const checked = checkAsset(asset, kind as AssetKind | undefined);
      return reply({ok: checked.ok, diagnostics: checked.diagnostics}, !checked.ok);
    } catch (error) { return failure(error); }
  });
  server.registerTool('project_build', {
    description: 'Build a portable project using the SDK builder. Writes its declared build output.',
    inputSchema: z.object({projectRoot: z.string().min(1)}),
  }, async ({projectRoot}) => serial(async () => {
    try {
      const built = await buildProject(resolve(projectRoot));
      return built.ok
        ? reply({ok: true, kind: built.value.kind, sdRoot: built.value.sdRoot,
          files: built.value.files, diagnostics: built.diagnostics, loadPlan: built.value.loadPlan})
        : reply({ok: false, diagnostics: built.diagnostics}, true);
    } catch (error) { return failure(error); }
  }));
  server.registerTool('emulator_launch', {
    description: 'Build and launch one project in an owned headless emulator.',
    inputSchema: z.object({projectRoot: z.string().min(1), executable: z.string().min(1).optional()}),
  }, async ({projectRoot, executable}) => serial(async () => {
    if (active) return reply({ok: false, error: 'An emulator session is active. Call emulator_stop first.'}, true);
    const root = resolve(projectRoot);
    try {
      const built = await buildProject(root);
      if (!built.ok) return reply({ok: false, diagnostics: built.diagnostics}, true);
      const emulator = await startEmulatorProcess({
        executable: executable ?? process.env.CLEMENTINA_EMULATOR ?? 'clementina-automation',
        sdRoot: resolve(root, built.value.sdRoot),
      });
      try {
        const state = await emulator.client.launchLoadPlan(built.value.loadPlan);
        active = {root, process: emulator, output: dirname(built.value.files.find(file => file.kind === 'load-plan')!.path)};
        return reply({ok: true, projectRoot: root, kind: built.value.kind, endpoint: emulator.endpoint, state});
      } catch (error) {
        await emulator.close().catch(() => undefined);
        return failure(error);
      }
    } catch (error) { return failure(error); }
  }));
  server.registerTool('emulator_stop', {description: 'Close the owned emulator process.'}, async () => serial(async () => {
    const session = active; active = undefined;
    if (!session) return reply({ok: true, stopped: false});
    try { await session.process.close(); return reply({ok: true, stopped: true}); }
    catch (error) { return failure(error); }
  }));
  server.registerTool('emulator_state', {description: 'Read CPU and execution state.'}, async () => {
    try { return await machine(async ({process}) => reply({ok: true, state: await process.client.executionState()})); }
    catch (error) { return failure(error); }
  });
  server.registerTool('emulator_control', {
    description: 'Run, pause, resume, reset, or step one instruction.',
    inputSchema: z.object({action: z.enum(['run', 'pause', 'resume', 'reset', 'stepInstruction'])}),
  }, async ({action}) => {
    try { return await machine(async ({process}) => reply({ok: true, state: await process.client[action]()})); }
    catch (error) { return failure(error); }
  });
  server.registerTool('emulator_step', {
    description: 'Advance a bounded number of cycles and return CPU state.',
    inputSchema: z.object({cycles: z.number().int().min(1).max(10_000_000)}),
  }, async ({cycles}) => {
    try { return await machine(async ({process}) => reply({ok: true, state: await process.client.step(cycles)})); }
    catch (error) { return failure(error); }
  });
  server.registerTool('emulator_input', {
    description: 'Inject 1–64 raw console bytes.',
    inputSchema: z.object({bytes: z.array(z.number().int().min(0).max(255)).min(1).max(64)}),
  }, async ({bytes}) => {
    try { return await machine(async ({process}) => reply({ok: true, state: await process.client.input(bytes)})); }
    catch (error) { return failure(error); }
  });
  server.registerTool('emulator_read_memory', {
    description: 'Read up to 256 CPU-addressed bytes; unmapped values are null.',
    inputSchema: z.object({address: z.number().int().min(0).max(65535), count: z.number().int().min(1).max(256)}),
  }, async ({address, count}) => {
    try { return await machine(async ({process}) =>
      reply({ok: true, address, bytes: await process.client.readMemory(address, count)})); }
    catch (error) { return failure(error); }
  });
  server.registerTool('emulator_audio', {description: 'Read the current 80-byte MIA audio register snapshot.'}, async () => {
    try { return await machine(async ({process}) => reply({ok: true, bytes: await process.client.audio()})); }
    catch (error) { return failure(error); }
  });
  server.registerTool('emulator_video_snapshot', {
    description: 'Save native MIA video bytes under the project build directory and return a SHA-256.',
  }, async () => {
    try { return await machine(async ({process, root, output}) => {
      const bytes = Buffer.from(await process.client.video());
      const relativePath = `${output}/inspection/mcp-video.bin`;
      const path = await resolveProjectPath(root, relativePath);
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, bytes);
      return reply({ok: true, path: relativePath, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')});
    }); } catch (error) { return failure(error); }
  });
  return server;
}
