import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkManifestText, manifestPathCandidates, manifestPathFieldAt} from '@clementina/project/node';
import {readFileSync} from 'node:fs';
const projectSchema = JSON.parse(readFileSync(new URL('../specs/schema/project.schema.json', import.meta.url), 'utf8'));

const example = new URL('../examples/catch-the-star/', import.meta.url);
async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'clementina-manifest-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await cp(example, root, {recursive: true});
  return {root, text: await readFile(join(root, 'clementina.yaml'), 'utf8')};
}
const lineOf = (text, needle) => text.split('\n').findIndex(line => line.includes(needle));

test('a valid manifest has no editor diagnostics', async t => {
  const {root, text} = await project(t);
  assert.deepEqual(await checkManifestText(root, text), []);
});

test('editor diagnostics sit on the text they are about', async t => {
  const {root, text} = await project(t);
  const missing = text.replace('src/stars.s', 'src/nope.s').replace('assets/palettes/star.palette.json', 'assets/palettes/gone.palette.json');
  const found = await checkManifestText(root, missing);
  assert.deepEqual(found.map(d => [d.code, d.message, d.start.line]), [
    ['project.io', 'assets/palettes/gone.palette.json: No such file in the project', lineOf(missing, 'gone.palette.json')],
    ['project.io', 'src/nope.s: No such file in the project', lineOf(missing, 'src/nope.s')],
  ]);
  const unknown = text.replace('paletteConfigId: palette-config:main', 'paletteConfigId: palette-config:nope');
  const [id] = await checkManifestText(root, unknown);
  assert.deepEqual([id.code, id.start, id.end.character - id.start.character], ['project.build.palette-config', {line: lineOf(unknown, 'palette-config:nope'), character: 21}, 'palette-config:nope'.length]);
  const noBasic = text.replace(/  basic:\n    outputName: game\n    memoryTop: .*\n/u, '');
  const [basic] = await checkManifestText(root, noBasic);
  assert.deepEqual([basic.code, basic.start, basic.end], ['project.build.basic', {line: lineOf(noBasic, 'build:'), character: 0}, {line: lineOf(noBasic, 'build:'), character: 5}]);
});

test('schema errors are left to the YAML extension, except hex addresses out of range', async t => {
  const {root, text} = await project(t);
  assert.deepEqual(await checkManifestText(root, text.replace('outputName: code', 'outputName: 9code')), []);
  assert.deepEqual(await checkManifestText(root, text.replace('loadAddress: $7000', 'loadAddress: 49152')), []);
  const high = text.replace('loadAddress: $7000', 'loadAddress: $C000');
  assert.deepEqual((await checkManifestText(root, high)).map(d => [d.code, d.message, d.start.line]), [['schema.maximum', '$C000 (49152) must be at most $BFFF (49151)', lineOf(high, '$C000')]]);
  const [bad] = await checkManifestText(root, text.replace('memoryTop: $7000', 'memoryTop: 7000h'));
  assert.equal(bad.code, 'project.address');
  const [yaml] = await checkManifestText(root, `${text}x: [\n`);
  assert.equal(yaml.code, 'project.yaml');
});

test('path completion knows which field the cursor is in', async t => {
  const {root, text} = await project(t);
  const lines = text.split('\n');
  const at = needle => { const line = lineOf(text, needle); return manifestPathFieldAt(text, line, lines[line].length); };
  assert.equal(at('main.palette.json').key, 'assets.palettes');
  assert.equal(at('main.palette-config.json').key, 'assets.paletteConfigs');
  assert.equal(at('entry:').key, 'program.entry');
  assert.equal(at('src/stars.s').key, 'build.assembly.sources');
  assert.equal(at('linkerConfig:').key, 'build.assembly.linkerConfig');
  assert.equal(at('outputName: code'), undefined);
  assert.equal(at('name: Catch'), undefined);
  assert.equal(manifestPathFieldAt('build:\n  assembly:\n    sources:\n      - ', 3, 8).key, 'build.assembly.sources');
  assert.deepEqual(await manifestPathCandidates(root, at('main.palette.json')), ['assets/palettes/basket.palette.json', 'assets/palettes/main.palette.json', 'assets/palettes/star.palette.json']);
  assert.deepEqual(await manifestPathCandidates(root, at('src/stars.s')), ['src/stars.s']);
  const folders = await manifestPathCandidates(root, {key: 'build.assembly.includeDirectories', kind: 'directory'});
  assert.ok(folders.includes('src') && !folders.some(folder => folder === 'build' || folder.startsWith('build/')));
});

test('every manifest field has a description for editor hover', () => {
  const missing = [];
  const walk = (node, path) => {
    if (path && !node.description) missing.push(path);
    for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, path ? `${path}.${key}` : key);
    if (node.items?.properties) for (const [key, child] of Object.entries(node.items.properties)) walk(child, `${path}[].${key}`);
  };
  walk(projectSchema, '');
  assert.deepEqual(missing, []);
});
