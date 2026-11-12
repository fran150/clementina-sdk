import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';

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
