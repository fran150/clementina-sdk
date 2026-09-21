import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {executeCommand,runCli} from '../packages/cli/dist/index.js';
const bin=new URL('../packages/cli/bin/clementina.mjs',import.meta.url);
const run=(...args)=>spawnSync(process.execPath,[bin.pathname,...args],{encoding:'utf8'});
test('CLI commands validate the example through shared APIs',async()=>{
 for(const args of [
  ['project','validate','examples/minimal-game'],
  ['asset','validate','examples/minimal-game/assets/palettes/main.palette.json'],
  ['sprite','validate','examples/minimal-game/assets/shapes/player_idle.shape.json'],
  ['animation','validate','examples/minimal-game/assets/animations/player_idle.animation.json'],
  ['doctor'],
 ]){const r=run(...args,'--json');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);}
});
test('CLI failures have predictable exit codes and JSON-only stdout',()=>{
 for(const [args,status,code] of [
  [['asset','validate','missing.json'],1,'asset.io'],
  [['asset','validate','package.json'],1,'asset.format'],
  [['project','validate','missing'],1,'project.io'],
  [['sprite','validate'],2,'cli.usage'],
  [['doctor','extra'],2,'cli.usage'],
  [['build'],2,'cli.usage'],
 ]){const r=run(...args,'--json');assert.equal(r.status,status);assert.equal(r.stderr,'');assert.equal(JSON.parse(r.stdout).diagnostics[0].code,code);}
});
test('wrong asset kind is rejected and help documents reference scope',async()=>{
 assert.equal((await executeCommand(['animation','validate','examples/minimal-game/assets/shapes/player_idle.shape.json'])).exitCode,1);
 const output=[];assert.equal(await runCli(['--help'],{stdout:t=>output.push(t),stderr:t=>assert.fail(t)}),0);
 assert.match(output.join(''),/project validate for references/);
});
