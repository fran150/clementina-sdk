import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Measurements only: the hardware test owner decides acceptance from the captured signal. */
export function analyzeWav(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected a RIFF/WAVE file');
  }
  if (bytes.readUInt32LE(4) + 8 > bytes.length) throw new Error('Truncated RIFF/WAVE file');
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size;
    if (end > bytes.length) throw new Error('Truncated WAV chunk');
    const id = bytes.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk');
      format = {
        encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    }
    if (id === 'data') data = bytes.subarray(start, end);
    offset = end + (size & 1);
  }
  if (!format || !data) throw new Error('WAV needs fmt and data chunks');
  if (format.encoding !== 1 || format.channels !== 2 || format.bitsPerSample !== 16 ||
      format.blockAlign !== 4 || format.sampleRate === 0 || data.length % 4 !== 0) {
    throw new Error('Expected stereo 16-bit PCM WAV');
  }
  const samples = data.length / 4;
  if (samples < 2) throw new Error('Capture is too short');
  const channels = [0, 1].map(channel => {
    let sum = 0, sumSquares = 0, peak = 0;
    for (let i = 0; i < samples; i++) {
      const value = data.readInt16LE(i * 4 + channel * 2) / 32768;
      sum += value; sumSquares += value * value; peak = Math.max(peak, Math.abs(value));
    }
    const mean = sum / samples, rms = Math.sqrt(Math.max(0, sumSquares / samples - mean * mean));
    let previous = data.readInt16LE(channel * 2) / 32768 - mean;
    const crossings = [];
    for (let i = 1; i < samples; i++) {
      const next = data.readInt16LE(i * 4 + channel * 2) / 32768 - mean;
      if (previous < 0 && next >= 0 && next !== previous) crossings.push(i - 1 - previous / (next - previous));
      previous = next;
    }
    const frequencyHz = crossings.length > 1 && rms > 0.001
      ? format.sampleRate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]) : null;
    return {
      rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : null,
      peakDbfs: peak > 0 ? 20 * Math.log10(peak) : null,
      zeroCrossingHz: frequencyHz,
    };
  });
  return {sampleRateHz: format.sampleRate, durationSeconds: samples / format.sampleRate, left: channels[0], right: channels[1]};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/analyze-audio-capture.mjs <stereo-pcm16.wav>');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(analyzeWav(await readFile(process.argv[2])), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  }
}
