#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spriteAttr, spriteExt} from '@clementina/assets';
import {loadProject, resolveProjectPath} from '@clementina/project/node';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const videoSpec = JSON.parse(await readFile(join(sdkRoot, 'specs/video.json'), 'utf8'));
const DISPLAY = {
  width: videoSpec.display.width, height: videoSpec.display.height,
  videoBytes: videoSpec.videoRegion.size,
  oamStart: videoSpec.regions.find(region => region.name === 'OAM').start,
  recordBytes: videoSpec.sprites.recordBytes,
};

/** Validate one animation's shared origin and compare a frame with an emulator OAM snapshot. */
export async function checkCharacter(projectDirectory, settings = {}) {
  const root = resolve(projectDirectory);
  const loaded = await loadProject(root);
  if (!loaded.ok) throw Error(loaded.diagnostics.map(d => `${d.code}: ${d.message}`).join('; '));
  const config = JSON.parse(await readFile(await resolveProjectPath(root, 'checks/character.json'), 'utf8'));
  if (!config || config.format !== 'clementina-character-check' || config.version !== 1
    || typeof config.animationId !== 'string' || !Number.isInteger(config.frameIndex)
    || !Number.isInteger(config.oamStart) || config.oamStart < 0 || config.oamStart >= videoSpec.sprites.count
    || !Number.isInteger(config.originX) || !Number.isInteger(config.originY)
    || typeof config.videoPath !== 'string') throw Error('Invalid checks/character.json');
  const {assets} = loaded.value;
  const animation = assets.animations.find(item => item.id === config.animationId);
  if (!animation) throw Error(`Unknown animation ${config.animationId}`);
  if (config.frameIndex < 0 || config.frameIndex >= animation.frames.length) throw Error('frameIndex is outside the animation');
  const shapes = animation.frames.map(frame => assets.shapes.find(shape => shape.id === frame.shapeId));
  if (shapes.some(shape => !shape)) throw Error('Animation has an unresolved shape');
  const anchor = shape => [shape.originAnchor ?? null, shape.originX ?? null, shape.originY ?? null,
    shape.canvasPixelWidth ?? null, shape.canvasPixelHeight ?? null];
  if (shapes.some(shape => JSON.stringify(anchor(shape)) !== JSON.stringify(anchor(shapes[0])))) {
    throw Error('Animation shapes must share the same origin and canvas');
  }
  const frame = animation.frames[config.frameIndex], shape = shapes[config.frameIndex];
  if (config.oamStart + shape.sprites.length > videoSpec.sprites.count) throw Error('Shape exceeds OAM records');
  const video = await readFile(await resolveProjectPath(root, config.videoPath));
  if (video.length !== DISPLAY.videoBytes) throw Error('Expected a native MIA video snapshot');
  const observed = [], expected = [];
  shape.sprites.forEach((sprite, index) => {
    const x = config.originX + (frame.dx ?? 0) + (frame.flipX ? -sprite.x - videoSpec.sprites.width : sprite.x);
    const y = config.originY + (frame.dy ?? 0) + (frame.flipY ? -sprite.y - videoSpec.sprites.height : sprite.y);
    expected.push([sprite.tile, x & 255, y & 255,
      spriteAttr({paletteBank: sprite.paletteBank, flipX: Boolean(sprite.flipX) !== Boolean(frame.flipX),
        flipY: Boolean(sprite.flipY) !== Boolean(frame.flipY)}),
      spriteExt({x, y, disabled: x <= -videoSpec.sprites.width || x >= DISPLAY.width
        || y <= -videoSpec.sprites.height || y >= DISPLAY.height})]);
    const offset = DISPLAY.oamStart + (config.oamStart + index) * DISPLAY.recordBytes;
    observed.push([...video.subarray(offset, offset + DISPLAY.recordBytes)]);
  });
  const spriteLayerEnabled = (video[0x20] & 1) !== 0 && (video[0x21] & 4) !== 0;
  const matches = spriteLayerEnabled
    && expected.every((record, index) => record.every((byte, offset) => byte === observed[index][offset]));
  if (!loaded.value.manifest.build) throw Error('Character inspection requires a project build');
  const outputRelative = `${loaded.value.manifest.build.outputDirectory}/inspection`;
  const output = await resolveProjectPath(root, outputRelative);
  await mkdir(output, {recursive: true});
  const report = {format: 'clementina-character-inspection', version: 1, project: root,
    animationId: animation.id, frameIndex: config.frameIndex, tilesetId: shape.tilesetId,
    anchor: anchor(shape), screen: DISPLAY, videoPath: config.videoPath,
    spriteLayerEnabled, spriteChrBank: video[0x2c],
    videoSha256: createHash('sha256').update(video).digest('hex'), expected, observed, matches};
  if (settings.renderer) {
    const rendered = spawnSync(settings.renderer, [], {input: JSON.stringify([...video]), maxBuffer: 8 * 1024 * 1024});
    if (rendered.error || rendered.status !== 0 || rendered.stdout.subarray(1, 4).toString() !== 'PNG'
      || rendered.stdout.readUInt32BE(16) !== DISPLAY.width || rendered.stdout.readUInt32BE(20) !== DISPLAY.height) {
      throw Error(`Renderer did not return a native 320x200 PNG: ${rendered.error?.message ?? rendered.stderr.toString()}`);
    }
    await writeFile(join(output, 'character.png'), rendered.stdout);
    report.png = `${outputRelative}/character.png`;
  }
  await writeFile(join(output, 'character-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (!matches) throw Error(`Character OAM mismatch; see ${join(output, 'character-report.json')}`);
  return {output, report};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [directory, option, renderer] = process.argv.slice(2);
    if (!directory || option && option !== '--renderer' || option && !renderer) {
      throw Error('Usage: create-character.mjs <project> [--renderer <clementina-render>]');
    }
    const {output} = await checkCharacter(directory, {renderer});
    console.log(`Character pose verified; report: ${join(output, 'character-report.json')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
