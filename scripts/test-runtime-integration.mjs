import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildProject} from '../packages/build/dist/index.js';
import {loadProject,saveProject} from '../packages/project/dist/node.js';
import {startEmulatorProcess} from '../packages/emulator-client/dist/node.js';
const [executable,renderer]=process.argv.slice(2);
if(!executable||!renderer)throw Error('Usage: node scripts/test-runtime-integration.mjs <automation> <renderer>');
const root=await mkdtemp(join(tmpdir(),'clementina-runtime-demo-'));
await cp(new URL('../examples/runtime-demo/',import.meta.url),root,{recursive:true});
// Extend the checked-in example with a large DMA transfer and a high placeholder
// index. Generate bulky fixtures here to keep the example small and readable.
const loaded=await loadProject(root);assert.equal(loaded.ok,true);
const project=loaded.value, large=structuredClone(project.assets.backgrounds[0]);
// Give the demo's animation a distinct second frame so TickAnimation's OAM
// effect can be checked, while both frames still use its one tileset.
project.assets.animations[0].frames.push({
 shapeId:project.assets.shapes[0].id,ticks:8,dx:5,dy:-3,flipX:true,
});
large.id='background:large';large.name='Large';large.width=400;large.height=100;
large.cells=Array.from({length:40000},(_,i)=>({...large.cells[0],tile:i%251,paletteBank:i%16}));
project.assets.backgrounds.push(large);project.manifest.assets.backgrounds.push('assets/backgrounds/large.json');
project.manifest.build.assets.slots.push({name:'large',bank:4,address:0x8000,size:80000});
project.manifest.build.assets.include.push({kind:'background',id:large.id,slot:'large'});
const overlay=project.assets.overlays[0];
for(let i=1;i<=128;i++)overlay.placeholders.push({id:'placeholder:p'+i,name:'P'+i,col:(i+1)%40,row:Math.floor((i+1)/40),width:1,height:1});
overlay.cells[129].tile=9;
await saveProject(root,project);
const source=await readFile(join(root,'src/main.s'),'utf8');
function replaceOnce(text,needle,replacement){
 assert.equal(text.split(needle).length,2,`Expected one fixture marker: ${needle}`);
 return text.replace(needle,replacement);
}
let instrumented=replaceOnce(source,'.export game_start, finished, failed',
 '.export game_start, finished, failed, sprite_drawn, animation_started, animation_advanced, animation_moved, animation_stopped, song_playing, song_stopped, sound_started, sound_second, sound_third, sound_released, sound_restarted, sound_stopped, input_ready');
for(const [needle,replacement] of [
 [' Check 30\n',' Check 30\nsprite_drawn:\n'],
 [' Check 34\n',' Check 34\nanimation_started:\n'],
 [' .endrepeat\n MoveAnimation',' .endrepeat\nanimation_advanced:\n MoveAnimation'],
 [' Check 36\n',' Check 36\nanimation_moved:\n'],
 [' Check 37\n',' Check 37\nanimation_stopped:\n'],
 [' Check 41\n',' Check 41\nsong_playing:\n'],
 [' SongPosition #0\n Check 42',' SongPosition #0\n sta $028A\n stx $028B\n sty $028C\n Check 42'],
 [' Check 43\n',' Check 43\nsong_stopped:\n'],
 [' Check 45\n',' Check 45\nsound_started:\n'],
 [' .repeat 4\n TickSound #2\n Check 46\n .endrepeat',[
  ' TickSound #2',' Check 46','sound_second:',
  ' TickSound #2',' Check 46','sound_third:',
  ' TickSound #2',' Check 46','sound_released:',
  ' TickSound #2',' Check 46',
  ' PlaySound SFX_JUMP, #2',' Check 61','sound_restarted:',
 ].join('\n')],
 [' Check 47\n',' Check 47\nsound_stopped:\n'],
 [' SetViewport #0, #0',' SetViewport #5, #1'],
 [' SetScroll #0, #0',' SetScroll #$0123, #$0045'],
 // A third WaitTick starts just after a tick, so it waits a whole one.
 [' Check 53\n',' Check 53\n WaitTick\n sta $0291\n Check 62\n'],
 [' ReadPad #0','input_ready:\n ReadPad #0'],
 [' Check 56\n',[
  ' Check 56',' ReadPad #2',' sta $0292',' Check 63',' KeyHeld #$04',' sta $0293',' Check 64',
  ' ReadPad #4',' bcs :+',' jmp failed',': lda rt_error',' sta $0294','',
 ].join('\n')],
])instrumented=replaceOnce(instrumented,needle,replacement);
instrumented=replaceOnce(instrumented,' lda #$A5',[
 ' FillPlaceholder OVL_HUD, #128, #digits',' Check 57',
 ' Load BG_LARGE, #$14000',' Check 58',' Relocate BG_LARGE, #$27880',' Check 59',
 ' GetCell BG_LARGE, #399, #99',' sta $0288',' stx $0289',' Check 60',' lda #$A5',
].join('\n'));
await writeFile(join(root,'src/main.s'),instrumented);
const built=await buildProject(root);
assert.equal(built.ok,true,JSON.stringify(built.diagnostics));
const build=built.value, symbols=build.assembly.debug.symbols;
const address=name=>{
 const value=symbols.find(s=>s.name===name)?.value;
 assert.ok(Number.isInteger(value),`Missing integration breakpoint ${name}`);
 return value;
};
const emulator=await startEmulatorProcess({executable,sdRoot:resolve(root,build.sdRoot)});
try {
 const c=emulator.client;
 const stops=['sprite_drawn','animation_started','animation_advanced','animation_moved','animation_stopped',
  'song_playing','song_stopped','sound_started','sound_second','sound_third','sound_released','sound_restarted','sound_stopped','input_ready','finished'];
 await c.addBreakpoint(address(stops[0]));
 await c.addBreakpoint(address('failed'));
 await c.launchLoadPlan(build.loadPlan);
 let stopIndex=0;
 async function nextStop(name){
  let state;
  for(let n=0;n<1500;n++){
   state=await c.state();
   if(!state.running)break;
   await new Promise(r=>setTimeout(r,10));
  }
  if(state.running)state=await c.pause();
  assert.equal(state.pc,address(name),`Expected ${name}; stopped at $${state.pc.toString(16)}`);
  assert.equal(name,stops[stopIndex]);
  await c.removeBreakpoint(address(name));
  stopIndex++;
  if(stopIndex<stops.length)await c.addBreakpoint(address(stops[stopIndex]));
 }
 const oam=(video,index)=>video.slice(0x10850+index*5,0x10850+(index+1)*5);
 await nextStop('sprite_drawn');
 let video=await c.video();
 assert.deepEqual(oam(video,0),[0,36,32,0,0],'DrawShape writes sprite 0');
 assert.equal(video[0x30],0,'DrawShape exposes sprite 0 to the renderer');
 await c.resume();
 await nextStop('animation_started');
 video=await c.video();
 assert.deepEqual(oam(video,1),[0,76,72,0,0],'StartAnimation draws frame 0 at its origin');
 assert.equal(video[0x30],1,'StartAnimation extends the renderer sprite count');
 await c.resume();
 await nextStop('animation_advanced');
 video=await c.video();
 assert.deepEqual(oam(video,1),[0,81,69,0x20,0],'TickAnimation draws frame 1 with offset and flip');
 await c.resume();
 await nextStop('animation_moved');
 video=await c.video();
 assert.deepEqual(oam(video,1),[0,89,77,0x20,0],'MoveAnimation redraws the current frame');
 await c.resume();
 await nextStop('animation_stopped');
 video=await c.video();
 assert.deepEqual(oam(video,1),[0,89,77,0x20,8],'StopAnimation disables its sprite');
 assert.deepEqual(oam(video,0),[0,36,32,0,0],'Stopping animation leaves other sprites visible');
 await c.resume();
 await nextStop('song_playing');
 let audio=await c.audio();
 const voice=(bytes,index)=>bytes.slice(0x10+index*0x10,0x10+(index+1)*0x10);
 assert.equal(audio[0],2,'audio register layout version');
 assert.equal(audio[2]&1,1,'PlaySong enables audio');
 assert.deepEqual([0,1,2,3].map(i=>voice(audio,i)[11]&3),[1,1,0,0],'PlaySong starts its two populated tracks');
 await c.resume();
 await nextStop('song_stopped');
 audio=await c.audio();
 assert.deepEqual([0,1].map(i=>voice(audio,i)[11]&3),[0,0],'StopSong stops both tracks');
 await c.resume();
 await nextStop('sound_started');
 audio=await c.audio();
 assert.deepEqual(voice(audio,2).slice(0,12),[0xa0,0x0f,128,4,2,1,0,3,220,0,0,2],
  'PlaySound takes voice 2 and writes its first frame');
 await c.resume();
 await nextStop('sound_second');
 audio=await c.audio();
 assert.deepEqual(voice(audio,2).slice(0,12),[0x88,0x13,128,4,2,1,0,3,200,0,0,2],
  'TickSound advances to the second frame');
 await c.resume();
 await nextStop('sound_third');
 audio=await c.audio();
 assert.deepEqual(voice(audio,2).slice(0,12),[0x70,0x17,96,4,2,1,0,0,160,0,0,2],
  'TickSound advances frequency, pulse and volume, then releases the gate');
 await c.resume();
 const third=audio;
 await nextStop('sound_released');
 audio=await c.audio();
 assert.equal(voice(audio,2)[11]&3,0,'final sound entry releases the voice');
 // The demo loads the sound into a CPU bank, and its last entry has 0 pairs.
 assert.deepEqual(voice(audio,2).slice(0,11),voice(third,2).slice(0,11),
  'an entry with 0 register pairs writes no voice register');
 assert.deepEqual([0,1,3].map(i=>voice(audio,i)),[0,1,3].map(i=>voice(third,i)),
  'TickSound writes only its own voice');
 await c.resume();
 await nextStop('sound_restarted');
 audio=await c.audio();
 assert.equal(voice(audio,2)[11]&3,2,'replaying the sound takes the voice again');
 assert.equal(voice(audio,2)[7],3,'replaying the sound gates the voice on');
 await c.resume();
 await nextStop('sound_stopped');
 audio=await c.audio();
 assert.equal(voice(audio,2)[11]&3,0,'StopSound releases an active sound');
 assert.equal(voice(audio,2)[7],0,'StopSound gates the voice off');
 await c.resume();
 await nextStop('input_ready');
 // Each record also holds bits ReadPad must drop: Sony labels, the right
 // stick, button X and L2.
 await c.setGamepadState(0,[0x80|0x04,0,0x02,0,0,0,0,0,0,0]);
 await c.setGamepadState(1,[0x80|0x40,0xf0|0x01,0x08,0x08|0x01,0,0,0,0,0,0]);
 await c.setHidUsage(7,0x2c,true);
 await c.setHidUsage(7,0x14,true);
 await c.resume();
 await nextStop('finished');
 video=await c.video();
 const mailbox=await c.readMemory(0x280,21);
 console.log({root,mailbox,finished:address('finished'),failed:address('failed')});
 assert.deepEqual(mailbox.slice(0,10),[60,0,0xa5,7,2,0x5a,192,0,39999%251,39999%16]);
 assert.equal(mailbox[12]&3,1,'SongPosition returns a running, non-taken sequencer status');
 assert.ok(mailbox[13]>=1,'WaitTick reports at least one tick');
 // MIA's clock follows host time, so allow a stalled host a tick or two more.
 assert.ok(mailbox[17]>=1&&mailbox[17]<=3,`A whole WaitTick reports ${mailbox[17]} ticks`);
 assert.equal(mailbox[14],0x04|0x20|0x10,'ReadPad 0: d-pad left, B, and Space as A');
 assert.equal(mailbox[15],0x01|0x80,'ReadPad 1: left stick up and Start, without the keyboard');
 assert.notEqual(mailbox[16],0,'KeyHeld sees Q held');
 assert.equal(mailbox[18],0,'A disconnected gamepad reads as nothing');
 assert.equal(mailbox[19],0,'KeyHeld reports a released key as 0');
 assert.equal(mailbox[20],6,'ReadPad rejects player 4 with RT_ERR_ARGUMENT');
 const bytes=video;
 assert.equal(bytes[0x21],1,'background layer enabled');
 assert.deepEqual(bytes.slice(0x22,0x28),[5,1,0x23,0x01,0x45,0x00],'viewport mode, table set and pixel scroll');
 assert.deepEqual(bytes.slice(0x28,0x2d),[2,2,2,2,2]);
 assert.equal(bytes[0x30],1,'SetSpriteCount exposes records 0 and 1');
 assert.deepEqual(oam(bytes,0),[0,36,32,0,8],'HideSprites disables the drawn shape');
 assert.deepEqual(oam(bytes,1),[0,89,77,0x20,8],'HideSprites keeps the animation disabled');
 assert.deepEqual(bytes.slice(0x100,0x110),bytes.slice(0x110,0x120),'palette bank copied');
 const chr=build.assets.assets.find(a=>a.kind==='tileset').bytes;
 assert.deepEqual(bytes.slice(0x3200,0x4a00),Array.from(chr),'CHR bank 2 after an SD load crossing CPU banks');
 const bg=build.assets.assets.find(a=>a.kind==='background').bytes;
 assert.deepEqual(bytes.slice(0xc200+1000,0xc200+2000),Array.from(bg.slice(0,1000)),'bank-backed background tiles');
 assert.deepEqual(bytes.slice(0xe140+1000,0xe140+2000),Array.from(bg.slice(1000)),'bank-backed background attributes');
 assert.equal(bytes[0x10080+129],0,'placeholder 128 uses its full 16-bit table offset');
 const rendered=spawnSync(renderer,[],{input:JSON.stringify(bytes),maxBuffer:8*1024*1024});
 assert.equal(rendered.status,0,rendered.stderr?.toString());
 await writeFile(join(root,'runtime.png'),rendered.stdout);
 console.log(`Runtime integration passed; snapshot: ${join(root,'runtime.png')}`);
} finally {await emulator.close();}
