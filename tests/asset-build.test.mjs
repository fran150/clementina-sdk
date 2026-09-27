import test from 'node:test';
import assert from 'node:assert/strict';
import {cellAttr,spriteAttr,noteFrequency,compileSong,encodeBackgroundFile,encodeOverlayFile,encodeSpriteFile,encodeSongFile,encodeSoundFile} from '../packages/assets/dist/index.js';

const lead={id:'instrument:lead',wave:1,pulse:128,attack:0,decay:6,sustain:10,release:5,volume:200};
const cell=(tile,paletteBank=0)=>({tile,paletteBank,flipX:false,flipY:false,priority:false,chrAlt:false});

test('notes use equal temperament with A4 at 440 Hz, in sixteenths of a hertz',()=>{
  assert.equal(noteFrequency(57),7040);
  assert.equal(noteFrequency(48),4186);
  assert.equal(noteFrequency(200),0xffff);
});

test('a song compiles to one sequencer track per voice that has notes',()=>{
  // 120 BPM at four steps a beat is 3,000 samples a step.
  const song={bpm:120,stepsPerBeat:4,length:16,loopStart:4,voices:[{pan:0,notes:[{step:0,length:4,pitch:48,instrumentId:lead.id},{step:4,length:4,pitch:52,instrumentId:lead.id}]},{pan:0,notes:[]},{pan:0,notes:[]},{pan:0,notes:[]}]};
  const instrument=[3,1, 4,0x06,0xa5, 7,128, 6,200];
  const want=[5,0, 2,0,0,0, ...instrument, 1,0x5a,0x10,0xde,0x2e,0,
    // The loop starts here, so nothing about the voice is assumed: the instrument is set again.
    2,0,0,0, ...instrument, 1,0x9a,0x14,0xde,0x2e,0,
    2,0xbf,0x5d,0,
    // JUMP back 27 bytes from the end of its operand, to offset 21.
    8,0xe5,0xff,0xff];
  const compiled=compileSong(song,[lead]);
  assert.deepEqual(Array.from(compiled.voices[0].bytes),want);
  assert.equal(compiled.voices[0].loop,21);
  assert.deepEqual(compiled.voices.slice(1),[null,null,null]);
  assert.equal(compiled.samples,48000);
  assert.equal(compiled.loopSample,12000);
  const file=encodeSongFile(song,[lead]);
  assert.deepEqual(Array.from(file.bytes),want);
  assert.deepEqual(file.voiceOffsets,[0,null,null,null]);
});

test('song files place each voice track back to back',()=>{
  const note={step:0,length:1,pitch:48,instrumentId:lead.id};
  const song={bpm:120,stepsPerBeat:4,length:1,voices:[{pan:0,notes:[]},{pan:0,notes:[note]},{pan:0,notes:[]},{pan:0,notes:[note]}]};
  const file=encodeSongFile(song,[lead]), track=compileSong(song,[lead]).voices[1].bytes;
  assert.deepEqual(file.voiceOffsets,[null,0,null,track.length]);
  assert.equal(file.bytes.length,track.length*2);
  assert.equal(file.bytes.at(-1),0,'a song without a loop ends each track with END');
});

test('sound files hold each frame as a count and register-value pairs',()=>{
  const sound={attack:0,decay:4,sustain:0,release:2,pan:0,frames:[{freq:4000,volume:220,pulse:128,wave:1,gate:true},{freq:5000,volume:200,pulse:128,wave:1,gate:true}]};
  const file=encodeSoundFile(sound);
  assert.deepEqual(Array.from(file.bytes),[
    9, 0,0xa0, 1,0x0f, 2,128, 3,0x04, 4,0x02, 5,1, 6,0, 8,220, 7,3,
    3, 0,0x88, 1,0x13, 8,200,
    // The entry after the last frame releases the gate.
    1, 7,0]);
  assert.equal(file.entries,3);
  sound.frames[1].gate=false;
  assert.deepEqual(Array.from(encodeSoundFile(sound).bytes.slice(-10)),[4, 0,0x88, 1,0x13, 8,200, 7,0, 0]);
});

test('sprite files hold shapes then animations and report where each one starts',()=>{
  const hero={id:'shape:hero',name:'Hero',sprites:[{tile:1,x:-8,y:16,paletteBank:3,flipX:true,flipY:false},{tile:2,x:0,y:16,paletteBank:3,flipX:false,flipY:false}]};
  const blink={id:'shape:blink',name:'Blink',sprites:[{tile:9,x:0,y:0,paletteBank:0,flipX:false,flipY:false}]};
  const walk={id:'animation:walk',name:'Walk',frames:[{shapeId:'shape:blink',ticks:6},{shapeId:'shape:hero',ticks:4,dx:-2,dy:1,flipX:true,flipY:true}]};
  const file=encodeSpriteFile([hero,blink],[walk]);
  assert.deepEqual(Array.from(file.bytes),[
    2, 1,0xf8,0xff,0x10,0, spriteAttr(hero.sprites[0]), 2,0,0,0x10,0, spriteAttr(hero.sprites[1]),
    1, 9,0,0,0,0, spriteAttr(blink.sprites[0]),
    2, 1,6,0,0,0,0,0, 0,4,0xfe,0xff,1,0,3]);
  assert.deepEqual(file.shapes.map(s=>[s.name,s.offset,s.size]),[['Hero',0,13],['Blink',13,7]]);
  assert.deepEqual(file.animations.map(a=>[a.name,a.offset,a.size]),[['Walk',20,15]]);
  assert.throws(()=>encodeSpriteFile([hero],[walk]),/not in this sprite file/);
});

test('background files are the tiles row by row, then the attributes',()=>{
  const flipped={...cell(4,2),flipX:true};
  const bytes=encodeBackgroundFile({width:3,height:2,cells:[cell(1),cell(2),cell(3),flipped,cell(5),cell(6,1)]});
  assert.deepEqual(Array.from(bytes),[1,2,3,4,5,6, 0,0,0,cellAttr(flipped),0,cellAttr(cell(6,1))]);
});

test('overlay files are the 1,000 tiles then the 1,000 attributes',()=>{
  const cells=Array.from({length:1000},(_,i)=>cell(i&255,i%8));
  const bytes=encodeOverlayFile({cells});
  assert.equal(bytes.length,2000);
  assert.equal(bytes[999],999&255);
  assert.equal(bytes[1000+999],cellAttr(cells[999]));
});
