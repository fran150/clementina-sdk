import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {cp, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {buildProject} from '../packages/build/dist/index.js';

test('hardware audio fixture builds into a ROM-loadable BASIC file', async()=>{
  const root=await mkdtemp(join(tmpdir(),'clementina-hardware-audio-'));
  try {
    await cp(new URL('../examples/hardware-audio/',import.meta.url),root,{recursive:true});
    const built=await buildProject(root);
    assert.equal(built.ok,true,JSON.stringify(built.diagnostics));
    assert.equal(built.value.kind,'basic');
    assert.equal(built.value.basic.lines,29);
    assert.ok((await readFile(join(root,'build/audio.bas'))).length>0);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('VS Code dependencies expose their package metadata for executable lookup',async()=>{
  const require=createRequire(import.meta.url);
  for(const [name,bin] of [
    ['@clementina/basic-lsp','clementina-basic-lsp.mjs'],
    ['@clementina/debug-adapter','clementina-debug-adapter.mjs'],
  ]){
    const packagePath=require.resolve(`${name}/package.json`);
    assert.equal((await stat(join(dirname(packagePath),'bin',bin))).isFile(),true);
  }
});
