#!/usr/bin/env node
import {cp, lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseDocument} from 'yaml';
import {buildProject} from '@clementina/build';
import {startEmulatorProcess} from '@clementina/emulator-client/node';
import {loadProject, resolveProjectPath} from '@clementina/project/node';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const templateRoot = join(sdkRoot, 'templates/basic-game');
const videoSpec = JSON.parse(await readFile(join(sdkRoot, 'specs/video.json'), 'utf8'));
const overlay = videoSpec.regions.find(region => region.name === 'OV_NT');
const usage = `Usage:
  node agents/workflows/create-game.mjs init <new-directory> [--name <name>]
  node agents/workflows/create-game.mjs check <project-directory> [--emulator <path>] [--renderer <path>]

check validates assets and references, builds, launches the ROM, captures video
state and CPU state, and runs checks/smoke.json when present. The renderer is the
optional clementina-render command; it creates native 320x200 PNGs.
`;

function options(args, names) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || i + 1 >= args.length || args[i + 1].startsWith('--') || values[args[i]] !== undefined) {
      throw new Error(`Invalid options.\n${usage}`);
    }
    values[args[i]] = args[i + 1];
  }
  return values;
}

export async function initGame(destination, name = 'Catch the Star') {
  const root = resolve(destination);
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Project name must be 1..80 characters');
  try { await lstat(root); throw new Error(`Destination already exists: ${root}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(root), {recursive: true});
  await cp(templateRoot, root, {recursive: true, errorOnExist: true, force: false});
  const manifestPath = join(root, 'clementina.yaml');
  const document = parseDocument(await readFile(manifestPath, 'utf8'));
  document.set('name', name);
  await writeFile(manifestPath, String(document));
  return root;
}

function requireResult(result, phase) {
  if (result.ok) return result.value;
  const details = result.diagnostics.map(d => `${d.source ?? ''}${d.path ?? ''}: ${d.code}: ${d.message}`).join('\n');
  throw new Error(`${phase} failed:\n${details}`);
}

function overlayRows(video) {
  const {columns, rows} = videoSpec.overlay;
  if (video.length !== videoSpec.videoRegion.size || overlay.size !== columns * rows) throw new Error('Invalid video snapshot or specification');
  return Array.from({length: rows}, (_, row) => video
    .slice(overlay.start + row * columns, overlay.start + (row + 1) * columns)
    .map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' ')
    .join('').trimEnd());
}

function capture(state, video) {
  return {
    state,
    videoBytes: video.length,
    videoSha256: createHash('sha256').update(Buffer.from(video)).digest('hex'),
    overlayRows: overlayRows(video),
  };
}

async function smokeConfig(root) {
  let raw;
  try { raw = await readFile(await resolveProjectPath(root, 'checks/smoke.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  const config = JSON.parse(raw);
  if (!config || !Number.isInteger(config.settleCycles) || config.settleCycles < 1 || config.settleCycles > 10_000_000
    || typeof config.beforeText !== 'string' || !config.beforeText
    || typeof config.afterText !== 'string' || !config.afterText
    || typeof config.input !== 'string' || !config.input || config.input.length > 64
    || [...config.input].some(char => char.charCodeAt(0) > 127)) {
    throw new Error('checks/smoke.json needs settleCycles (1..10000000), beforeText, ASCII input (1..64 bytes), and afterText');
  }
  return config;
}

function render(renderer, video, output) {
  const result = spawnSync(renderer, [], {input: JSON.stringify(video), maxBuffer: 4 * 1024 * 1024});
  if (result.error || result.status !== 0 || result.stdout.subarray(1, 4).toString() !== 'PNG'
    || result.stdout.readUInt32BE(16) !== videoSpec.display.width
    || result.stdout.readUInt32BE(20) !== videoSpec.display.height) {
    throw new Error(`Renderer failed: ${result.error?.message ?? result.stderr.toString()}`);
  }
  return writeFile(output, result.stdout);
}

export async function checkGame(projectDirectory, settings = {}, dependencies = {}) {
  const root = resolve(projectDirectory);
  const project = requireResult(await loadProject(root), 'Project validation');
  const build = requireResult(await buildProject(root), 'Build');
  const smoke = await smokeConfig(root);
  const output = await resolveProjectPath(root, `${project.manifest.build.outputDirectory}/inspection`);
  await mkdir(output, {recursive: true});
  const emulator = await (dependencies.startEmulatorProcess ?? startEmulatorProcess)({
    executable: settings.emulator ?? process.env.CLEMENTINA_EMULATOR ?? 'clementina-automation',
    sdRoot: resolve(root, build.sdRoot),
  });
  let report;
  try {
    // A palette load can still be completing after the ROM has echoed a command.
    // This is an automation processing budget, not a hardware timing constant.
    await emulator.client.launchLoadPlan(build.loadPlan, {inputCycles: 1_000_000});
    await emulator.client.pause();
    const beforeState = await emulator.client.step(smoke?.settleCycles ?? 3_000_000);
    const beforeVideo = await emulator.client.video();
    const before = capture(beforeState, beforeVideo);
    const paletteFile = build.files.find(file => file.kind === 'palette');
    const palette = paletteFile ? await readFile(await resolveProjectPath(root, paletteFile.path)) : undefined;
    const loadedPalette = paletteFile ? {
      assetId: paletteFile.assetId,
      found: palette.length === paletteFile.length
        && palette.equals(Buffer.from(beforeVideo.slice(paletteFile.address, paletteFile.address + paletteFile.length))),
    } : undefined;
    await writeFile(join(output, 'before.video.bin'), Buffer.from(beforeVideo));
    if (settings.renderer) await render(settings.renderer, beforeVideo, join(output, 'before.png'));

    let after;
    if (smoke) {
      await emulator.client.input(Array.from(smoke.input, char => char.charCodeAt(0)));
      const afterState = await emulator.client.step(smoke.settleCycles);
      const afterVideo = await emulator.client.video();
      after = capture(afterState, afterVideo);
      await writeFile(join(output, 'after.video.bin'), Buffer.from(afterVideo));
      if (settings.renderer) await render(settings.renderer, afterVideo, join(output, 'after.png'));
    }
    const visible = rows => rows.join('\n');
    report = {
      format: 'clementina-game-inspection', version: 1,
      project: root, kind: build.kind, loadPlan: `${project.manifest.build.outputDirectory}/load-plan.json`,
      before, ...(after ? {after} : {}),
      checks: {
        ...(loadedPalette ? {loadedPalette} : {}),
        ...(smoke ? {
          beforeText: {expected: smoke.beforeText, found: visible(before.overlayRows).includes(smoke.beforeText)},
          afterText: {expected: smoke.afterText, found: visible(after.overlayRows).includes(smoke.afterText)},
          videoChanged: before.videoSha256 !== after.videoSha256,
        } : {}),
      },
    };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  } finally {
    await emulator.close();
  }
  if (report.checks.loadedPalette?.found === false
    || smoke && (!report.checks.beforeText.found || !report.checks.afterText.found || !report.checks.videoChanged)) {
    throw new Error(`Smoke inspection failed; see ${join(output, 'report.json')}`);
  }
  return {output, report};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, directory, ...rest] = process.argv.slice(2);
    if (!directory || !['init', 'check'].includes(command)) throw new Error(usage);
    if (command === 'init') {
      const args = options(rest, ['--name']);
      const root = await initGame(directory, args['--name']);
      console.log(`Created ${root}`);
    } else {
      const args = options(rest, ['--emulator', '--renderer']);
      const {output, report} = await checkGame(directory, {emulator: args['--emulator'], renderer: args['--renderer']});
      console.log(`Validated, built, ran, and inspected ${report.project}`);
      console.log(`CPU: PC=$${report.before.state.pc.toString(16).toUpperCase().padStart(4, '0')}, cycles=${report.before.state.cycles}`);
      console.log(`Screen:\n${report.before.overlayRows.filter(Boolean).join('\n')}`);
      if (report.after) console.log(`After input:\n${report.after.overlayRows.filter(Boolean).join('\n')}`);
      console.log(`Inspection: ${join(output, 'report.json')}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
