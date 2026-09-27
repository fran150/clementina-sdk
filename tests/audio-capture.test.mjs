import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWav} from '../scripts/analyze-audio-capture.mjs';

function wav(sampleRate, seconds, left, right) {
  const frames = sampleRate * seconds, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    bytes.writeInt16LE(Math.round(32767 * left(i / sampleRate)), 44 + i * 4);
    bytes.writeInt16LE(Math.round(32767 * right(i / sampleRate)), 46 + i * 4);
  }
  return bytes;
}

test('audio capture analyzer measures stereo level and tone frequency',()=>{
  const result=analyzeWav(wav(48000,1,t=>0.5*Math.sin(2*Math.PI*440*t),t=>0.05*Math.sin(2*Math.PI*880*t)));
  assert.equal(result.sampleRateHz,48000);
  assert.ok(Math.abs(result.left.zeroCrossingHz-440)<1);
  assert.ok(Math.abs(result.right.zeroCrossingHz-880)<1);
  assert.ok(result.left.rmsDbfs-result.right.rmsDbfs>19);
});

test('audio capture analyzer rejects formats it cannot measure',()=>{
  assert.throws(()=>analyzeWav(Buffer.from('not a wav')),/RIFF/);
  const silent=analyzeWav(wav(48000,1,()=>0,()=>0));
  assert.equal(silent.left.zeroCrossingHz,null);
  assert.equal(silent.left.rmsDbfs,null);
});
