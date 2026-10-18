import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
// Writes the ca65 includes for 6502 code from specs/*.json:
// - mia.inc: MIA's registers, ids, bits and MIA RAM layout, under MIA's own #define names
//   where MIA has one. The SDK runtime includes it, and the ROM keeps a copy in
//   src/include/mia.inc that npm run check:drift compares with this output.
// - clementina.inc: mia.inc plus the kernel jump table, the VIA and the fixed CPU addresses
//   programs use. The build puts both on every assembly project's include path.

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asmDir = path.join(sdkRoot, 'packages', 'runtime', 'asm');

/** Every spec file, keyed by file name. */
export function loadSpecs(dir = path.join(sdkRoot, 'specs')) {
  return Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(path.join(dir, f), 'utf8'))]));
}

const firstSentence = text => (text ?? '').split(/(?<=\.)\s/)[0];

/**
 * One symbol per name. `mia` says what MIA's headers hold under the same name: 'must' when MIA
 * defines it (check:drift fails if MIA lacks it or disagrees), 'maybe' for the further bytes of a
 * multi-byte field (compared only where MIA defines them), false when MIA has no #define for it.
 */
const sym = (name, value, comment, mia = 'must', format = 'hex') => ({name, value, comment, mia, format});
const mask = n => 2 ** n;

/** MIA's per-byte names for a field: NAME, NAME_L/_H, NAME_L/_M/_H, or NAME0-NAME3. */
export function byteNames(name, size) {
  if (size === 2) return [`${name}_L`, `${name}_H`];
  if (size === 3) return [`${name}_L`, `${name}_M`, `${name}_H`];
  if (size === 4) return [0, 1, 2, 3].map(i => `${name}${i}`);
  return [name];
}

const fieldSymbols = (prefix, fields, base = 0) => fields.flatMap(f =>
  byteNames(f.name, f.size).map((name, i) => sym(`${prefix}${name}`, base + f.offset + i, i ? undefined : firstSentence(f.description), i ? 'maybe' : 'must')));

/** The sections of mia.inc, in file order. */
export function miaSections(specs) {
  const regs = specs['mia-registers.json'].registers.filter(r => !r.name.startsWith('RESERVED_'));
  const ctx = regs.find(r => r.name === 'MIA_CTX');
  const input = specs['input.json'], video = specs['video.json'], audio = specs['audio.json'], storage = specs['storage.json'];
  const indexes = specs['mia-indexes.json'], ram = specs['mia-ram-map.json'];
  const block = name => ram.blocks.find(b => b.name === name);
  const region = (list, name) => list.find(r => r.name === name);
  const attrs = (prefix, fields) => Object.entries(fields).map(([key, bits]) => {
    const name = key.replace(/(Bits?|Bit)$/, '').replace(/[A-Z]/g, c => `_${c}`).toUpperCase();
    const value = Array.isArray(bits) ? (mask(bits[1] + 1) - mask(bits[0])) : mask(bits);
    return sym(`${prefix}${name}`, value, Array.isArray(bits) ? `bits ${bits[0]}-${bits[1]}` : `bit ${bits}`, false, 'bin');
  });
  const audioState = block('AUDIO').start;

  return [
    {title: 'Registers ($FFE0-$FFFF), mia-registers.json', symbols: [
      ...regs.map(r => sym(r.name, r.address, firstSentence(r.description), false)),
      ...regs.filter(r => r.name.endsWith('_VEC_L')).map(r => sym(r.name.slice(0, -2), r.address, '16-bit vector', false)),
      ...ctx.values.map(v => sym(v.name, v.value, `MIA_CTX: ${firstSentence(v.description)}`)),
      ...input.status.bits.map(b => sym(b.name, mask(b.bit), `INPUT_STATUS bit ${b.bit}: ${firstSentence(b.description)}`, 'must', 'bin')),
    ]},
    {title: 'Status bits (STATUS_L, STATUS_H as one 16-bit value), mia-status.json', symbols:
      specs['mia-status.json'].bits.map(b => sym(b.name, mask(b.bit), `bit ${b.bit}: ${firstSentence(b.description)}`))},
    {title: 'IRQ bits (IRQ_STATUS_L/H, IRQ_MASK_L/H as 16-bit values), mia-irq.json', symbols:
      specs['mia-irq.json'].bits.map(b => sym(b.name, mask(b.bit), `bit ${b.bit}: ${firstSentence(b.description)}`))},
    {title: 'Error codes (ERROR_L), mia-errors.json', symbols:
      specs['mia-errors.json'].errors.map(e => sym(e.name, e.code, firstSentence(e.description)))},
    {title: 'Configuration fields (CFG_SELECT), mia-config.json', symbols:
      specs['mia-config.json'].fields.map(f => sym(`CFG_${f.name}`, f.id, firstSentence(f.description)))},
    {title: 'Commands (CMD_TRIGGER), mia-commands.json', symbols:
      specs['mia-commands.json'].commands.map(c => sym(`MIA_CMD_${c.name}`, c.id))},
    {title: 'Index descriptors MIA configures, mia-indexes.json', symbols: [
      ...indexes.ids.filter(e => /^MIA_/.test(e.name ?? '')).map(e => sym(e.name, e.id, (e.count ?? 1) > 1 ? `first of ${e.count}` : undefined)),
      ...indexes.flagBits.map(f => sym(`IDX_FLAG_${f.name}`, f.bit, `CFG_IDXA_FLAGS/CFG_IDXB_FLAGS bit: ${firstSentence(f.description)}`, 'must', 'dec')),
    ]},
    {title: 'Video RAM, video.json', symbols: [
      ...[['RENDER_CONTROL', 'MIA_VIDEO_RENDER_CONTROL_OFFSET'], ['PALETTE', 'MIA_VIDEO_PALETTE_OFFSET'], ['CHR', 'MIA_VIDEO_CHR_OFFSET'], ['BG_NT', 'MIA_VIDEO_BG_NT_OFFSET'], ['BG_ATTR', 'MIA_VIDEO_BG_ATTR_OFFSET'], ['OV_NT', 'MIA_VIDEO_OVERLAY_NT_OFFSET'], ['OV_ATTR', 'MIA_VIDEO_OVERLAY_ATTR_OFFSET'], ['OAM', 'MIA_VIDEO_OAM_OFFSET']]
        .map(([name, macro]) => sym(macro, region(video.regions, name).start, `${region(video.regions, name).size} bytes`)),
      sym('MIA_VIDEO_STATE_SIZE', block('VIDEO').endExclusive, 'video RAM ends here', 'must', 'dec'),
      ...video.renderControl.fields.map(f => sym(`MIA_VIDEO_${f.name.replace(/^VIDEO_/, '')}_OFFSET`, f.address, firstSentence(f.description), f.name === 'VIDEO_MODE' ? 'must' : false)),
      ...video.renderControl.modeBits.map(b => sym(`MIA_VIDEO_MODE_${b.name}`, mask(b.bit), `VIDEO_MODE bit ${b.bit}`, false, 'bin')),
      ...video.renderControl.layerBits.map(b => sym(`MIA_VIDEO_LAYER_${b.name}`, mask(b.bit), `LAYER_ENABLE bit ${b.bit}`, false, 'bin')),
      ...attrs('MIA_VIDEO_ATTR_', video.attributes.backgroundOverlay),
      ...attrs('MIA_VIDEO_SPRITE_ATTR_', video.attributes.spriteAttr),
      ...attrs('MIA_VIDEO_SPRITE_EXT_', video.attributes.spriteExt),
    ]},
    {title: 'Input RAM, input.json', symbols: [
      sym('MIA_INPUT_STATE_OFFSET', block('INPUT').start),
      ...[['KEYBOARD_BITMAP', 'MIA_INPUT_KEYBOARD_BITMAP_OFFSET'], ['CONSUMER_BITMAP', 'MIA_INPUT_CONSUMER_BITMAP_OFFSET'], ['MOUSE_STATE', 'MIA_INPUT_MOUSE_STATE_OFFSET'], ['INPUT_CONTROL', 'MIA_INPUT_CONTROL_OFFSET'], ['GAMEPAD_0', 'MIA_INPUT_GAMEPAD_OFFSET'], ['CLOCK_MS', 'MIA_CLOCK_SNAPSHOT_OFFSET']]
        .map(([name, macro]) => sym(macro, region(input.regions, name).start)),
      sym('GAMEPAD_SLOT_SIZE', input.gamepads.recordBytes, `bytes per gamepad, ${input.gamepads.count} gamepads`, 'must', 'dec'),
      sym('MIA_INPUT_TEXT_FIFO_SIZE', input.textFifo.size, undefined, 'must', 'dec'),
      ...input.modes.map(m => sym(`MIA_INPUT_MODE_${m.name.toUpperCase().replace(/-/g, '_')}`, m.id)),
    ]},
    {title: 'Audio RAM, audio.json', symbols: [
      sym('MIA_AUDIO_STATE_OFFSET', audioState),
      sym('MIA_AUDIO_HEADER_OFFSET', audioState),
      sym('MIA_AUDIO_HEADER_SIZE', audio.headerBytes, undefined, 'must', 'dec'),
      sym('MIA_AUDIO_VOICES_OFFSET', audioState + audio.headerBytes),
      sym('MIA_AUDIO_VOICE_SIZE', audio.voiceRecordBytes, undefined, 'must', 'dec'),
      sym('MIA_AUDIO_VOICE_COUNT', audio.voices, undefined, 'must', 'dec'),
      ...Object.entries(audio.headerOffsets).map(([k, v]) => sym(`MIA_AUDIO_HEADER_${k}`, v, 'header field')),
      ...Object.entries(audio.headerStatusBits).map(([k, v]) => sym(`MIA_AUDIO_STATUS_${k}`, mask(v), `HEADER_STATUS bit ${v}`, 'must', 'bin')),
      ...Object.entries(audio.headerFlagBits).map(([k, v]) => sym(`MIA_AUDIO_FLAG_${k}`, mask(v), `HEADER_FLAGS bit ${v}`, 'must', 'bin')),
      sym('MIA_AUDIO_MASTER_VOLUME_MAX', audio.masterVolume.max, undefined, 'must', 'dec'),
      ...Object.entries(audio.voiceOffsets).map(([k, v]) => sym(`MIA_AUDIO_VOICE_${k}`, v, 'voice record field')),
      ...Object.entries(audio.controlBits).map(([k, v]) => sym(`MIA_AUDIO_CONTROL_${k}`, mask(v), `VOICE_CONTROL bit ${v}`, 'must', 'bin')),
      ...audio.waveforms.map(w => sym(`MIA_AUDIO_WAVE_${w.name.toUpperCase()}`, w.id)),
      sym('MIA_AUDIO_SEQ_STATUS_RUNNING', mask(audio.sequencer.status.runningBit), 'VOICE_SEQ_STATUS bit', 'must', 'bin'),
      sym('MIA_AUDIO_SEQ_STATUS_TAKEN', mask(audio.sequencer.status.takenBit), 'VOICE_SEQ_STATUS bit', 'must', 'bin'),
      ...audio.sequencer.opcodes.map(o => sym(`MIA_SEQ_OP_${o.name}`, o.id, 'sequencer opcode')),
    ]},
    {title: 'SD and filesystem RAM, storage.json', symbols: [
      ...[['CONTROL', 'MIA_SD_CONTROL'], ['SECTOR_BUFFER', 'MIA_SD_SECTOR'], ['PATH', 'MIA_FS_PATH'], ['DIR_ENTRY', 'MIA_FS_DIR_ENTRY'], ['TRANSFER', 'MIA_FS_TRANSFER'], ['PATH2', 'MIA_FS_PATH2']].flatMap(([name, prefix]) => [
        sym(`${prefix}_OFFSET`, region(storage.regions, name).start),
        sym(`${prefix}_SIZE`, region(storage.regions, name).size, undefined, 'must', 'dec'),
      ]),
      sym('MIA_SD_MAX_HANDLES', storage.maxFileHandles, undefined, 'must', 'dec'),
      ...fieldSymbols('MIA_SD_CONTROL_', storage.controlFields),
      ...storage.statusBits.map(b => sym(`MIA_SD_STATUS_${b.name}`, mask(b.bit), `MIA_SD_CONTROL_STATUS bit ${b.bit}`, 'must', 'bin')),
      ...storage.cardTypes.map(t => sym(`MIA_SD_CARD_${t.name}`, t.id, 'MIA_SD_CONTROL_CARD_TYPE value')),
      ...storage.openModes.map(m => sym(`MIA_FS_OPEN_${m.name}`, m.id, 'MIA_SD_CONTROL_OPEN_MODE value')),
      ...fieldSymbols('MIA_FS_DIR_', storage.dirEntryFields),
      ...storage.dirAttributeBits.map(b => sym(`MIA_FS_DIR_ATTR_${b.name}`, mask(b.bit), `MIA_FS_DIR_ATTR bit ${b.bit}`, false, 'bin')),
    ]},
  ];
}

/** The sections clementina.inc adds after including mia.inc. */
export function programSections(specs) {
  const abi = specs['kernel-abi.json'], map = specs['cpu-memory-map.json'];
  const page = name => map.pages.find(p => p.name === name);
  const zp = page('ZERO_PAGE').blocks.find(b => b.name === 'PROGRAMS');
  const clock = page('INPUT_PAGE').blocks.find(b => b.name === 'CLOCK_SNAPSHOT');
  const clockLocations = page('INPUT_PAGE').locations.filter(l => l.address >= clock.start && l.address < clock.endExclusive);
  return [
    {title: 'Kernel jump table, kernel-abi.json: JSR these; they never move', symbols:
      abi.entries.filter(e => !e.target).map(e => sym(e.symbol, e.address, undefined, false))},
    {title: 'BASIC entry points, kernel-abi.json: fixed too, but only while BASIC is in memory', symbols:
      abi.entries.filter(e => e.target).map(e => sym(e.symbol, e.address, undefined, false))},
    {title: 'Zero page free for programs, cpu-memory-map.json', symbols: [
      sym('ZP_FREE_START', zp.start, undefined, false),
      sym('ZP_FREE_END', zp.endExclusive - 1, 'last free byte', false),
    ]},
    {title: 'Clock snapshot that KERN_RDTIM writes, cpu-memory-map.json', symbols: [
      sym('CLOCK_SNAPSHOT', clock.start, undefined, false),
      ...clockLocations.map(l => sym(l.name, l.address, `${l.size} byte${l.size === 1 ? '' : 's'}`, false)),
    ]},
    {title: '65C22 VIA, cpu-memory-map.json', symbols: [
      sym('VIA_BASE', map.via.base, `registers repeat every ${map.via.mirrorPeriod} bytes`, false),
      ...map.via.registers.map(r => sym(r.name, r.address, firstSentence(r.description), false)),
    ]},
  ];
}

const formatValue = ({value, format}) => {
  if (format === 'dec') return String(value);
  if (format === 'bin' && value < 0x100) return `%${value.toString(2).padStart(8, '0')}`;
  const digits = value < 0x100 ? 2 : value < 0x10000 ? 4 : 6;
  return `$${value.toString(16).toUpperCase().padStart(digits, '0')}`;
};

function renderSections(sections) {
  const width = Math.max(...sections.flatMap(s => s.symbols.map(x => x.name.length)));
  const out = [];
  for (const section of sections) {
    out.push('', `; ${section.title}`);
    for (const s of section.symbols) {
      const line = `${s.name.padEnd(width)} = ${formatValue(s)}`;
      out.push(s.comment ? `${line.padEnd(width + 12)} ; ${s.comment}` : line);
    }
  }
  return out;
}

/** Symbols in mia.inc, in order; names must be unique. */
export function miaSymbols(specs) { return miaSections(specs).flatMap(s => s.symbols); }

export function renderMiaInc(specs) {
  return [
    '; mia.inc: MIA registers, ids, bits and MIA RAM layout for ca65.',
    '; Generated by clementina-sdk scripts/generate-includes.mjs from specs/*.json. Do not edit:',
    '; change the spec, run npm run generate:includes, and copy the file to the ROM\'s src/include/.',
    '; Names are MIA\'s own #defines where MIA has one. Bit values are masks except IDX_FLAG_*,',
    '; which are bit numbers as in MIA. Multi-byte fields name each byte: _L/_M/_H or 0-3.',
    '.ifndef MIA_INC',
    'MIA_INC = 1',
    ...renderSections(miaSections(specs)),
    '',
    '.endif',
    '',
  ].join('\n');
}

export function renderClementinaInc(specs) {
  return [
    '; clementina.inc: everything a Clementina assembly program can rely on, for ca65.',
    '; Generated by clementina-sdk scripts/generate-includes.mjs from specs/*.json. Do not edit.',
    '; Call the kernel only through the jump table; other kernel addresses move between builds.',
    '.ifndef CLEMENTINA_INC',
    'CLEMENTINA_INC = 1',
    '',
    '.include "mia.inc"',
    ...renderSections(programSections(specs)),
    '',
    '.endif',
    '',
  ].join('\n');
}

/** Name collisions would make ca65 fail; report them before anyone assembles. */
export function duplicateNames(specs) {
  const seen = new Set(), dups = new Set();
  for (const s of [...miaSymbols(specs), ...programSections(specs).flatMap(x => x.symbols)]) (seen.has(s.name) ? dups : seen).add(s.name);
  return [...dups];
}

function main(argv) {
  const specs = loadSpecs();
  const dups = duplicateNames(specs);
  if (dups.length) throw Error(`Include symbols defined twice: ${dups.join(', ')}`);
  const files = [['mia.inc', renderMiaInc(specs)], ['clementina.inc', renderClementinaInc(specs)]];
  for (const [name, text] of files) {
    const target = path.join(asmDir, name);
    if (argv.includes('--check')) {
      let current = '';
      try { current = readFileSync(target, 'utf8'); } catch {}
      if (current !== text) throw Error(`Generated ${name} is stale; run npm run generate:includes`);
    } else writeFileSync(target, text);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
