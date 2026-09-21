import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, symlink, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkAsset, checkAssetSet, validatePalette} from '@clementina/assets';
import {ValidationError} from '@clementina/core';
import {checkProjectManifest, createAssetResolver, fromStudioProjectV2, toStudioProjectV2} from '@clementina/project';
import {loadProject, saveProject, resolveProjectPath} from '@clementina/project/node';
const fixture = new URL('../examples/minimal-game/', import.meta.url);
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'clementina-')); t.after(() => rm(root, {recursive:true,force:true})); return root; }
async function example(t) {const root=await temporary(t);await cp(fixture,root,{recursive:true});return root;}

test('unknown input produces structured diagnostics without throwing', () => {
  for (const value of [null, false, 0, '', [], {}, {palettes:null}]) {
    assert.equal(checkAsset(value).ok, false);
    assert.equal(checkAssetSet(value).ok, false);
    assert.equal(checkProjectManifest(value).ok, false);
  }
  const r=checkAsset({format:'clementina-palette',version:1,id:12,name:'A',colors:[-1],extra:true});
  assert.equal(r.ok,false); assert.ok(r.diagnostics.length>=4);
  assert.ok(r.diagnostics.some(d=>d.path==='/id'));
  assert.throws(()=>validatePalette(null), ValidationError);
});

test('load, resolve and save preserve portable assets', async t => {
  const loaded=await loadProject(await example(t)); assert.equal(loaded.ok,true,JSON.stringify(loaded.diagnostics));
  const resolver=createAssetResolver(loaded.value);
  for (const [kind,assets] of Object.entries(loaded.value.assets)) for (const asset of assets) {
    const entry=resolver.byId(kind,asset.id); assert.equal(resolver.byPath(entry.path).asset,asset);
  }
  assert.equal(resolver.byId('shapes','missing'),undefined);
  const target=await temporary(t);
  await cp(new URL('src/',fixture),join(target,'src'),{recursive:true});
  await saveProject(target,loaded.value);
  const back=await loadProject(target); assert.equal(back.ok,true);assert.deepEqual(back.value,loaded.value);
});

test('references report asset file and JSON pointer', async t => {
  const root=await example(t), loaded=await loadProject(root);
  const path=loaded.value.manifest.assets.shapes[0];
  const shape=loaded.value.assets.shapes[0];shape.tilesetId='missing';
  await writeFile(join(root,path),JSON.stringify(shape));
  const r=await loadProject(root);assert.equal(r.ok,false);
  assert.ok(r.diagnostics.some(d=>d.code==='asset.reference'&&d.source===path&&d.path==='/tilesetId'));
});

test('loader reports malformed YAML, missing files and wrong asset kind', async t => {
  const root=await example(t);
  await writeFile(join(root,'clementina.yaml'),'name: one\nname: two\n');
  assert.equal((await loadProject(root)).diagnostics[0].code,'project.yaml');
  const other=await example(t), loaded=await loadProject(other);
  const path=loaded.value.manifest.assets.palettes[0];await rm(join(other,path));
  assert.ok((await loadProject(other)).diagnostics.some(d=>d.source===path));
  await writeFile(join(other,path),JSON.stringify(loaded.value.assets.shapes[0]));
  assert.equal((await loadProject(other)).ok,false);
});

test('path checks reject traversal, duplicate destinations, collisions and symlinks', async t => {
  const root=await example(t), loaded=await loadProject(root);
  for(const path of ['../escape','/absolute','C:/drive','a\\b','a//b','./a','a\0b']) await assert.rejects(resolveProjectPath(root,path));
  await symlink(await temporary(t),join(root,'link'));
  await assert.rejects(resolveProjectPath(root,'link/new.json'),ValidationError);
  await symlink(join(root,'absent'),join(root,'dangling'));
  await assert.rejects(resolveProjectPath(root,'dangling'),ValidationError);
  const p=structuredClone(loaded.value);p.manifest.assets.palettes[0]=p.manifest.program.entry;
  const before=await readFile(join(root,p.manifest.program.entry),'utf8');
  await assert.rejects(saveProject(root,p),ValidationError);
  assert.equal(await readFile(join(root,p.manifest.program.entry),'utf8'),before);
  const m=structuredClone(loaded.value.manifest);m.assets.shapes[0]=m.assets.palettes[0];
  assert.equal(checkProjectManifest(m).ok,false);
});

test('golden Studio conversion preserves portable content and excludes session state', async () => {
  const studio=JSON.parse(await readFile(new URL('fixtures/studio-v2.json',import.meta.url),'utf8'));
  const expected=JSON.parse(await readFile(new URL('fixtures/portable-v1.json',import.meta.url),'utf8'));
  assert.deepEqual(fromStudioProjectV2(studio),expected);
  assert.deepEqual(fromStudioProjectV2(toStudioProjectV2(expected)),expected);
});

test('unknown versions and schema drift cases are rejected', async t => {
  const loaded=await loadProject(await example(t));
  for(const assets of Object.values(loaded.value.assets)) for(const asset of assets) {
    assert.equal(checkAsset({...asset,version:2}).ok,false);
    assert.equal(checkAsset({...asset,sessionOnly:true}).ok,false);
  }
  const palette=loaded.value.assets.palettes[0];
  assert.equal(checkAsset({...palette,name:'x'.repeat(65)}).ok,false);
  assert.equal(checkAsset({...palette,id:123}).ok,false);
});

test('save preflight rejects file/directory collisions without writing assets', async t => {
  const loaded=await loadProject(await example(t)), target=await temporary(t);
  loaded.value.manifest.assets.palettes[0]='conflict';
  loaded.value.manifest.assets.shapes[0]='conflict/shape.json';
  await assert.rejects(saveProject(target,loaded.value),ValidationError);
  await assert.rejects(readFile(join(target,'conflict')));
});

test('Studio conversion rejects an explicit dangling tileset reference', async () => {
  const studio=JSON.parse(await readFile(new URL('fixtures/studio-v2.json',import.meta.url),'utf8'));
  studio.shapes[0].tilesetId='missing';
  assert.throws(()=>fromStudioProjectV2(studio),/does not resolve/);
});
