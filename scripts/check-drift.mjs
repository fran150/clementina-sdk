#!/usr/bin/env node
// Drift check: compares the SDK specs with the MIA firmware and ROM sources they copy.
//
//   node scripts/check-drift.mjs [--mia DIR] [--rom DIR] [--record]
//
// MIA side: the C headers under src/mia (plus sd.c for the SD pins and the *_configure_index calls
// for index reset defaults). ROM side: a fresh cc65 build of the ROM in a temporary folder, read
// through kernel.dbg (every symbol, by module), kernel.lbl (linker symbols) and kernel.bin (the
// keyword name tables), plus the ROM's committed copy of mia.inc. Names and values are compared;
// descriptions are not. --record writes the commits it checked into specs/source-manifest.json,
// and only when everything matches.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {miaSections, renderMiaInc} from './generate-includes.mjs';

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// C sources

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');

/** `#define` lines of one C file: name -> {params, body}. A later definition replaces an earlier one. */
export function cDefines(text) {
  const out = new Map();
  for (const line of stripComments(text.replace(/\\\r?\n/g, ' ')).split('\n')) {
    const m = /^\s*#\s*define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*?)\s*$/.exec(line);
    if (m && m[4]) out.set(m[1], {params: m[2] ? m[3].split(',').map(s => s.trim()).filter(Boolean) : null, body: m[4]});
  }
  return out;
}

/** Enumerators of one C file as macros: an implicit value is the previous one plus one. */
export function cEnums(text) {
  const out = new Map();
  for (const [, body] of stripComments(text).matchAll(/\benum\b[^{;]*\{([^}]*)\}/g)) {
    let previous = null;
    for (const item of body.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = /^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/s.exec(item);
      if (!m) continue;
      const value = m[2] ?? (previous === null ? '0' : `(${previous}) + 1`);
      out.set(m[1], {params: null, body: value});
      previous = value;
    }
  }
  return out;
}

/** Static functions whose body is a single `return expr;`, usable like function-like macros. */
export function cReturnFunctions(text) {
  const out = new Map();
  for (const m of stripComments(text).matchAll(/\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{\s*return\s+([^;]+);\s*\}/g)) {
    if (['if', 'while', 'for', 'switch'].includes(m[1])) continue;
    const params = m[2].split(',').map(p => p.trim().split(/\s+/).at(-1)).filter(p => p && p !== 'void');
    out.set(m[1], {params, body: m[3]});
  }
  return out;
}

const CAST = /\(\s*(?:const\s+)?(?:u?int(?:8|16|32|64)_t|unsigned(?:\s+(?:int|long|char))?|int|long|size_t)\s*\)/g;

/** Evaluates a C integer expression. `vars` holds plain variables such as a loop's `i`. */
export function evaluate(expr, macros, vars = {}, depth = 0) {
  if (depth > 32) throw Error(`macro expansion too deep in ${expr}`);
  let text = String(expr).replace(CAST, ' ');
  // Function-like macros, innermost first; an expansion can bring in more of them.
  const mark = t => t.replace(/(?<!\u0000)\b([A-Za-z_]\w*)\s*\(/g, (all, name) => (macros.get(name)?.params ? `\u0000${name}(` : all));
  text = mark(text);
  while (text.includes('\u0000')) {
    const start = text.lastIndexOf('\u0000'), open = text.indexOf('(', start);
    let level = 0, end = open;
    for (; end < text.length; end++) if (text[end] === '(') level++; else if (text[end] === ')' && --level === 0) break;
    const args = [];
    let current = '', nested = 0;
    for (const ch of text.slice(open + 1, end)) {
      if (ch === ',' && nested === 0) { args.push(current); current = ''; continue; }
      if (ch === '(') nested++;
      if (ch === ')') nested--;
      current += ch;
    }
    if (current.trim() || args.length) args.push(current);
    const def = macros.get(text.slice(start + 1, open));
    let body = def.body;
    def.params.forEach((p, i) => { body = body.replace(new RegExp(`\\b${p}\\b`, 'g'), `(${args[i]})`); });
    text = mark(`${text.slice(0, start)}(${body})${text.slice(end + 1)}`);
  }
  text = text.replace(CAST, ' ').replace(/\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b\d+[uUlL]*\b|\b[A-Za-z_]\w*\b/g, token => {
    if (/^\d/.test(token)) return `${BigInt(token.replace(/[uUlL]+$/, ''))}n`;
    if (token in vars) return `${BigInt(vars[token])}n`;
    const def = macros.get(token);
    if (!def || def.params) throw Error(`unknown symbol ${token}`);
    return `(${BigInt(evaluate(def.body, macros, vars, depth + 1))}n)`;
  });
  if (!/^[\s\dn+\-*/%<>|&^~()]*$/.test(text)) throw Error(`cannot evaluate ${expr}`);
  return Number(Function(`"use strict"; return (${text});`)());
}

const walk = (dir, ext) => readdirSync(dir).flatMap(name => {
  const file = path.join(dir, name);
  return statSync(file).isDirectory() ? walk(file, ext) : name.endsWith(ext) ? [file] : [];
}).sort();

/** MIA's C sources: every header's defines and enums, plus per-file lookups for .c files. */
export class MiaSource {
  constructor(dir) {
    this.dir = dir;
    this.files = new Map();
    this.macros = new Map();
    this.where = new Map();
    this.conflicts = new Map();
    for (const file of walk(path.join(dir, 'src', 'mia'), '.h')) {
      const rel = path.relative(dir, file).split(path.sep).join('/'), text = readFileSync(file, 'utf8');
      const defs = new Map([...cEnums(text), ...cDefines(text)]);
      this.files.set(rel, defs);
      for (const [name, def] of defs) {
        if (this.macros.has(name) && this.macros.get(name).body !== def.body) this.conflicts.set(name, [this.where.get(name), rel]);
        this.macros.set(name, def);
        this.where.set(name, rel);
      }
    }
  }
  /** Macros a .c file sees: the headers, then its own defines, enums and one-line functions. */
  macrosFor(rel) {
    const text = readFileSync(path.join(this.dir, rel), 'utf8');
    return new Map([...this.macros, ...cEnums(text), ...cDefines(text), ...cReturnFunctions(text)]);
  }
  value(name, macros = this.macros) {
    if (this.conflicts.has(name)) throw Error(`${name} has two definitions (${this.conflicts.get(name).join(', ')})`);
    if (!macros.has(name)) throw Error(`${name} is not defined`);
    return evaluate(name, macros);
  }
  /** Object-like names matching `pattern`, from the headers whose path matches `files`. */
  names(pattern, files = /./) {
    const out = new Map();
    for (const [rel, defs] of this.files) if (files.test(rel)) for (const [name, def] of defs) if (!def.params && pattern.test(name)) out.set(name, rel);
    return out;
  }
}

/** Splits `a, b(c, d), e` at top-level commas. */
const splitArgs = text => {
  const out = [];
  let current = '', level = 0;
  for (const ch of text) {
    if (ch === ',' && level === 0) { out.push(current.trim()); current = ''; continue; }
    if (ch === '(') level++;
    if (ch === ')') level--;
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

/**
 * Index reset defaults from a C file's `*_configure_index(id, start, length[, flag])` calls. Each
 * helper's body says which flags it sets (directly, or under `if (param)`) and the step it uses.
 * Calls inside a loop over `i` are evaluated at i = 0 and i = 1 for a run's first id and stride.
 * Calls whose arguments use run-time variables are not reset defaults and are skipped.
 */
export function indexDefaults(text, macros) {
  const clean = stripComments(text), helpers = new Map(), out = new Map();
  for (const m of clean.matchAll(/\b(\w+_configure_index)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g)) {
    const params = m[2].split(',').map(p => p.trim().split(/\s+/).at(-1));
    const body = m[3], flagsOf = s => [...s.matchAll(/IDX_FLAG_(\w+)/g)].map(f => f[1]);
    const always = flagsOf(/\.flags\s*=([^;]*);/.exec(body)?.[1] ?? '');
    const conditional = [...body.matchAll(/if\s*\(\s*(\w+)\s*\)\s*\{([^}]*)\}/g)].map(c => ({param: params.indexOf(c[1]), flags: flagsOf(c[2])}));
    const step = /\.step\s*=\s*([^;]+);/.exec(body)?.[1];
    const shape = new RegExp(`default_addr\\s*=\\s*${params[1]}\\s*;`).test(body) && new RegExp(`limit_addr\\s*=\\s*${params[1]}\\s*\\+\\s*${params[2]}\\s*;`).test(body);
    helpers.set(m[1], {always, conditional, step, shape});
  }
  for (const m of clean.matchAll(/\b(\w+_configure_index)\s*\(/g)) {
    const helper = helpers.get(m[1]);
    if (!helper) continue;
    let level = 0, end = m.index + m[0].length - 1;
    for (; end < clean.length; end++) if (clean[end] === '(') level++; else if (clean[end] === ')' && --level === 0) break;
    const args = splitArgs(clean.slice(m.index + m[0].length, end));
    if (args.length < 3) continue;
    const at = i => {
      const vars = {i};
      return {id: evaluate(args[0], macros, vars), start: evaluate(args[1], macros, vars), length: evaluate(args[2], macros, vars)};
    };
    let first;
    try { first = at(0); } catch { continue; }
    const looped = args.slice(0, 3).some(a => /\bi\b/.test(a)), second = looped ? at(1) : null;
    const flags = [...helper.always];
    for (const c of helper.conditional) if (c.param >= 0 && args[c.param] && !/^(false|0u?)$/.test(args[c.param])) flags.push(...c.flags);
    let step;
    try { step = evaluate(helper.step, macros); } catch { step = undefined; }
    const entry = {start: first.start, length: first.length, step, flags: [...new Set(flags)].sort(), shape: helper.shape};
    if (second) entry.stride = second.start - first.start, entry.idStride = second.id - first.id;
    if (!out.has(first.id)) out.set(first.id, entry);
  }
  return out;
}

/** A CMake cache variable's default, from `set(NAME "value" CACHE ...)`. */
export function cmakeDefault(text, name) {
  const m = new RegExp(`^\\s*set\\(\\s*${name}\\s+"([^"]*)"\\s+CACHE\\b`, 'm').exec(text.replace(/#.*$/gm, ''));
  if (!m) throw Error(`${name} has no CACHE default`);
  return m[1];
}

/** A palette file's RGB565 little-endian words, `perBank` to a bank. */
export function paletteBanks(bin, perBank) {
  if (bin.length % (perBank * 2)) throw Error(`is ${bin.length} bytes, not whole banks of ${perBank} colors`);
  return Array.from({length: bin.length / (perBank * 2)}, (_, bank) => Array.from({length: perBank}, (__, c) => bin.readUInt16LE((bank * perBank + c) * 2)));
}

/** A CHR dump as [bank][plane][tile], each tile its rows as hex. */
export function chrTiles(bin, chr) {
  if (bin.length !== chr.banks * chr.bytesPerBank) throw Error(`is ${bin.length} bytes, not ${chr.banks} banks of ${chr.bytesPerBank}`);
  const rows = chr.planeBytes / chr.tilesPerBank;
  return Array.from({length: chr.banks}, (_, bank) => Array.from({length: chr.planes}, (__, plane) => Array.from({length: chr.tilesPerBank}, (___, tile) => {
    const at = bank * chr.bytesPerBank + plane * chr.planeBytes + tile * rows;
    return bin.subarray(at, at + rows).toString('hex');
  })));
}

// ---------------------------------------------------------------------------------------------
// ROM build

/** Parses an ld65 debug file: symbols with their module, and segments with their file offsets. */
export function parseDbg(text) {
  const records = kind => text.split('\n').filter(l => l.startsWith(`${kind}\t`)).map(l => {
    const out = {};
    for (const m of l.slice(kind.length + 1).matchAll(/(\w+)=("[^"]*"|[^,]*)/g)) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
    return out;
  });
  const modules = new Map(records('mod').map(m => [m.id, m.name.replace(/\.o$/, '')]));
  const scopes = new Map(records('scope').map(s => [s.id, modules.get(s.mod)]));
  const symbols = records('sym').filter(s => s.val !== undefined).map(s => ({name: s.name, value: Number(s.val), type: s.type, module: scopes.get(s.scope)}));
  const segments = records('seg').filter(s => s.ooffs !== undefined).map(s => ({name: s.name, start: Number(s.start), size: Number(s.size), offset: Number(s.ooffs)}));
  return {symbols, segments};
}

/** Parses a VICE label file (`al 000400 .NAME`). */
export const parseLbl = text => new Map([...text.matchAll(/^al\s+([0-9A-Fa-f]+)\s+\.(\S+)$/gm)].map(m => [m[2], parseInt(m[1], 16)]));

/** Reads a keyword name table (last character of each name has bit 7 set; a zero byte ends it). */
export function nameTable(bin, segments, start, end = Infinity) {
  const seg = segments.find(s => start >= s.start && start < s.start + s.size);
  if (!seg) throw Error(`no output segment holds $${start.toString(16)}`);
  const names = [];
  let name = '';
  for (let addr = start; addr < Math.min(end, seg.start + seg.size); addr++) {
    const byte = bin[seg.offset + addr - seg.start];
    if (byte === 0 && !name) break;
    name += String.fromCharCode(byte & 0x7f);
    if (byte & 0x80) { names.push(name); name = ''; }
  }
  return names;
}

/** Reads a zero-terminated string. */
export function cString(bin, segments, start) {
  const seg = segments.find(s => start >= s.start && start < s.start + s.size);
  if (!seg) throw Error(`no output segment holds $${start.toString(16)}`);
  let text = '';
  for (let addr = start; addr < seg.start + seg.size; addr++) {
    const byte = bin[seg.offset + addr - seg.start];
    if (byte === 0) return text;
    text += String.fromCharCode(byte);
  }
  throw Error(`no zero byte ends the string at $${start.toString(16)}`);
}

/** The operand of the JMP at `address`. */
export function jmpOperand(bin, segments, address) {
  const seg = segments.find(s => address >= s.start && address + 3 <= s.start + s.size);
  if (!seg) throw Error(`no output segment holds $${address.toString(16)}`);
  const at = seg.offset + address - seg.start;
  if (bin[at] !== 0x4c) throw Error(`$${address.toString(16)} is not a JMP`);
  return bin[at + 1] | (bin[at + 2] << 8);
}

/** Builds the ROM into a temporary folder; returns its symbols, labels and image. */
export function buildRom(dir) {
  const out = mkdtempSync(path.join(tmpdir(), 'clementina-drift-'));
  try {
    execFileSync('make', ['-C', dir, 'kernel', `BUILD_DIR=${out}`, `LD65=ld65 --dbgfile ${out}/kernel.dbg`], {stdio: ['ignore', 'pipe', 'pipe']});
    const dbg = parseDbg(readFileSync(path.join(out, 'kernel.dbg'), 'utf8'));
    return {...dbg, labels: parseLbl(readFileSync(path.join(out, 'kernel.lbl'), 'utf8')), bin: readFileSync(path.join(out, 'kernel.bin'))};
  } catch (error) {
    throw Error(`ROM build failed (needs cc65 and make): ${error.stderr?.toString().trim() || error.message}`);
  } finally {
    rmSync(out, {recursive: true, force: true});
  }
}

/** Lookups over a ROM build. `module` is kernel, basic or wozmon. */
export class RomBuild {
  constructor(build) { Object.assign(this, build); }
  find(name, module) {
    const all = this.symbols.filter(s => s.name === name && (!module || s.module === module));
    const values = [...new Set(all.map(s => s.value))];
    if (values.length > 1) throw Error(`${name} has ${values.length} values in ${module ?? 'the ROM'}`);
    return all[0];
  }
  value(name, module) {
    const symbol = this.find(name, module);
    if (!symbol) throw Error(`${name} is not defined${module ? ` in ${module}` : ''}`);
    return symbol.value;
  }
  label(name) {
    if (!this.labels.has(name)) throw Error(`${name} is not in kernel.lbl`);
    return this.labels.get(name);
  }
  /** Every module's equate or label with this name, for checking ROM copies of MIA values. */
  copies(name) { return this.symbols.filter(s => s.name === name && (s.type === 'equ' || s.type === 'lab')); }
}

// ---------------------------------------------------------------------------------------------
// Report

const show = v => (typeof v === 'number' ? (v > 9 ? `${v} ($${v.toString(16).toUpperCase()})` : String(v)) : JSON.stringify(v));

/** The first place two JSON values differ, as [path suffix, spec value, source value]. */
export function firstDifference(expected, actual, at = '') {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
      if (i >= expected.length) return [`${at}[${i}]`, undefined, actual[i]];
      if (i >= actual.length) return [`${at}[${i}]`, expected[i], undefined];
      const d = firstDifference(expected[i], actual[i], `${at}[${i}]`);
      if (d) return d;
    }
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      const d = firstDifference(expected[key], actual[key], `${at}.${key}`);
      if (d) return d;
    }
  }
  return [at, expected, actual];
}

export class Report {
  constructor() { this.checked = 0; this.problems = []; }
  /** Records one comparison; `actual` may be a function that throws when the source lacks it. */
  same(spec, label, expected, actual, source) {
    this.checked++;
    let value;
    try { value = typeof actual === 'function' ? actual() : actual; } catch (error) {
      const message = error.message.startsWith(label) ? error.message : `${label}: ${error.message}`;
      this.problems.push(`${spec}: ${message}${source ? ` (${source})` : ''}`);
      return;
    }
    const d = firstDifference(expected, value);
    if (!d) return;
    const [at, want, got] = d, missing = v => (v === undefined ? 'missing' : show(v));
    this.problems.push(`${spec}: ${label}${at} is ${missing(want)} in the spec but ${missing(got)} in ${source}`);
  }
  extra(spec, name, source) { this.problems.push(`${spec}: ${name} is in ${source} but not in the spec`); }
  fail(spec, message) { this.problems.push(`${spec}: ${message}`); }
}

const hex = s => parseInt(String(s).replace(/^\$/, '').split(/[-\s]/)[0], 16);
const bit = n => 2 ** n;

/** Spec table <-> upstream names, both ways. `upstream` maps upstream name -> source file. */
function table(report, spec, entries, upstreamName, specValue, upstream, valueOf, where = 'the MIA headers') {
  const seen = new Set();
  for (const e of entries) {
    const name = upstreamName(e);
    seen.add(name);
    report.same(spec, name, specValue(e), () => valueOf(name), upstream.get(name) ?? where);
  }
  for (const [name, file] of upstream) if (!seen.has(name)) report.extra(spec, name, file);
}

/** ROM equates and labels that copy a spec value under the same name. */
function romCopies(report, spec, rom, name, expected) {
  for (const s of rom.copies(name)) report.same(spec, `${name} (ROM ${s.module})`, expected, s.value, `the ROM's ${s.module} module`);
}

// ---------------------------------------------------------------------------------------------
// Checks

export function checkMia(report, specs, mia, rom) {
  const v = name => mia.value(name), where = name => mia.where.get(name) ?? 'MIA';
  const same = (spec, label, expected, macro) => report.same(spec, label, expected, () => v(macro), `${macro} in ${where(macro)}`);

  table(report, 'mia-commands.json', specs['mia-commands.json'].commands, e => `MIA_CMD_${e.name}`, e => e.id, mia.names(/^MIA_CMD_/), v);
  for (const e of specs['mia-commands.json'].commands) for (const name of [`CMD_${e.name}`, `MIA_CMD_${e.name}`]) romCopies(report, 'mia-commands.json', rom, name, e.id);

  table(report, 'mia-errors.json', specs['mia-errors.json'].errors, e => e.name, e => e.code, mia.names(/^ERROR_(?!DEFER_)/, /etc\/err\.h$/), v, 'src/mia/etc/err.h');
  for (const e of specs['mia-errors.json'].errors) romCopies(report, 'mia-errors.json', rom, e.name, e.code);

  for (const [file, prefix, header] of [['mia-status.json', /^MIA_STAT_/, 'src/mia/etc/status.h'], ['mia-irq.json', /^IRQ_/, 'src/mia/irq/irq.h']]) {
    const key = 'bits';
    table(report, file, specs[file][key], e => e.name, e => bit(e.bit), mia.names(prefix, new RegExp(`${header.replace(/[./]/g, '\\$&')}$`)), v, header);
    for (const e of specs[file][key]) romCopies(report, file, rom, e.name, bit(e.bit));
  }

  table(report, 'mia-config.json', specs['mia-config.json'].fields, e => `CFG_${e.name}`, e => e.id, mia.names(/^CFG_/, /etc\/cfg\.h$/), v, 'src/mia/etc/cfg.h');
  for (const e of specs['mia-config.json'].fields) romCopies(report, 'mia-config.json', rom, `CFG_${e.name}`, e.id);

  const indexes = specs['mia-indexes.json'];
  const firmwareIds = indexes.ids.filter(e => /^MIA_/.test(e.name ?? ''));
  table(report, 'mia-indexes.json', firmwareIds, e => e.name, e => e.id, mia.names(/^MIA_(INPUT|VIDEO|AUDIO|SD|FS)_INDEX_/), v);
  table(report, 'mia-indexes.json', indexes.flagBits, e => `IDX_FLAG_${e.name}`, e => e.bit, mia.names(/^IDX_FLAG_/, /mem\/indexes\.h$/), v, 'src/mia/mem/indexes.h');
  for (const e of firmwareIds) romCopies(report, 'mia-indexes.json', rom, e.name, e.id);
  for (const e of indexes.ids.filter(e => e.docName)) romCopies(report, 'mia-indexes.json', rom, e.docName, e.id);
  const defaults = new Map();
  for (const rel of [...walk(path.join(mia.dir, 'src', 'mia'), '.c')].map(f => path.relative(mia.dir, f).split(path.sep).join('/'))) {
    const text = readFileSync(path.join(mia.dir, rel), 'utf8');
    if (!/_configure_index\s*\(/.test(text)) continue;
    for (const [id, d] of indexDefaults(text, mia.macrosFor(rel))) defaults.set(id, {...d, file: rel});
  }
  for (const e of indexes.ids.filter(e => e.default)) {
    const d = defaults.get(e.id), label = `${e.name} default`;
    if (!d) { report.same('mia-indexes.json', label, e.default, () => { throw Error('no *_configure_index call sets it'); }); continue; }
    if (!d.shape) report.fail('mia-indexes.json', `${label}: the helper in ${d.file} no longer sets the default and limit from (start, length)`);
    const got = {start: d.start, length: d.length, ...((e.count ?? 1) > 1 ? {stride: d.stride ?? 0} : {}), step: d.step, flags: d.flags};
    const want = {start: e.default.start, length: e.default.length, ...((e.count ?? 1) > 1 ? {stride: e.default.stride ?? 0} : {}), step: e.default.step, flags: [...e.default.flags].sort()};
    report.same('mia-indexes.json', label, want, got, d.file);
    if ((e.count ?? 1) > 1) report.same('mia-indexes.json', `${e.name} run`, 1, d.idStride, d.file);
  }

  const ram = specs['mia-ram-map.json'], block = name => ram.blocks.find(b => b.name === name);
  same('mia-ram-map.json', 'size', ram.size, 'MIA_RAM_SIZE');
  for (const [name, start, end] of [
    ['VIDEO', '0', 'MIA_VIDEO_STATE_SIZE'],
    ['INPUT', 'MIA_INPUT_STATE_OFFSET', 'MIA_INPUT_STATE_OFFSET + MIA_INPUT_STATE_SIZE'],
    ['AUDIO', 'MIA_AUDIO_STATE_OFFSET', 'MIA_AUDIO_STATE_OFFSET + MIA_AUDIO_STATE_SIZE'],
    ['SD_FS', 'MIA_SD_STATE_OFFSET', 'MIA_FS_TRANSFER_OFFSET + MIA_FS_TRANSFER_SIZE'],
  ]) {
    report.same('mia-ram-map.json', `${name} start`, block(name)?.start, () => evaluate(start, mia.macros), start);
    report.same('mia-ram-map.json', `${name} end`, block(name)?.endExclusive, () => evaluate(end, mia.macros), end);
  }

  const gpio = specs['mia-gpio.json'], sdMacros = mia.macrosFor('src/mia/sd/sd.c');
  const pins = new Map([...mia.names(/_PIN$/, /hardware\/gpio_mapping\.h$/), ...[...cDefines(readFileSync(path.join(mia.dir, 'src/mia/sd/sd.c'), 'utf8')).keys()].filter(n => /^MIA_SD_\w+_PIN$/.test(n)).map(n => [n, 'src/mia/sd/sd.c'])]);
  for (const p of gpio.pins) report.same('mia-gpio.json', `GPIO ${p.gpio} (${p.define}${p.offset !== undefined ? ` + ${p.offset}` : ''})`, p.gpio, () => evaluate(p.define, sdMacros) + (p.offset ?? 0), pins.get(p.define) ?? where(p.define));
  for (const [name, file] of pins) if (!gpio.pins.some(p => p.define === name)) report.extra('mia-gpio.json', name, file);

  const machine = specs['machine.json'];
  same('machine.json', 'miaRam.size', machine.miaRam.size, 'MIA_RAM_SIZE');
  same('machine.json', 'timing.defaultPhi2Hz', machine.timing.defaultPhi2Hz, 'MIA_DEFAULT_PHI2_HZ');
  same('machine.json', 'timing.requestedPhi2MinHz', machine.timing.requestedPhi2MinHz, 'MIA_MIN_PHI2_HZ');
  same('machine.json', 'timing.requestedPhi2MaxHz', machine.timing.requestedPhi2MaxHz, 'MIA_MAX_PHI2_HZ');

  const video = specs['video.json'], region = (list, name) => list.find(r => r.name === name);
  same('video.json', 'pages.size', video.pages.size, 'MIA_VIDEO_PAGE_SIZE');
  same('video.json', 'pages.count', video.pages.count, 'MIA_VIDEO_PAGE_COUNT');
  same('video.json', 'pages.syncable', video.pages.syncable, 'MIA_VIDEO_SYNC_PAGE_COUNT');
  same('video.json', 'network.udpPort', video.network.udpPort, 'MIA_VIDEO_UDP_PORT');
  for (const [name, macro] of [['RENDER_CONTROL', 'MIA_VIDEO_RENDER_CONTROL_OFFSET'], ['PALETTE', 'MIA_VIDEO_PALETTE_OFFSET'], ['CHR', 'MIA_VIDEO_CHR_OFFSET'], ['BG_NT', 'MIA_VIDEO_BG_NT_OFFSET'], ['BG_ATTR', 'MIA_VIDEO_BG_ATTR_OFFSET'], ['OV_NT', 'MIA_VIDEO_OVERLAY_NT_OFFSET'], ['OV_ATTR', 'MIA_VIDEO_OVERLAY_ATTR_OFFSET'], ['OAM', 'MIA_VIDEO_OAM_OFFSET']]) {
    same('video.json', `regions ${name} start`, region(video.regions, name)?.start, macro);
  }
  const oam = region(video.regions, 'OAM');
  same('video.json', 'regions OAM end', oam && oam.start + oam.size, 'MIA_VIDEO_STATE_SIZE');
  // MIA embeds palettes/<MIA_PALETTE>.palette.bin and copies it into palette RAM when video starts.
  const palette = video.palettes.default, paletteFile = `palettes/${palette.name}.palette.bin`;
  report.same('video.json', 'palettes.default.name', palette.name, () => cmakeDefault(readFileSync(path.join(mia.dir, 'CMakeLists.txt'), 'utf8'), 'MIA_PALETTE'), 'CMakeLists.txt MIA_PALETTE');
  report.same('video.json', 'palettes.default.colors', palette.colors, () => paletteBanks(readFileSync(path.join(mia.dir, paletteFile)), video.palettes.colorsPerBank), paletteFile);
  // Likewise charsets/<MIA_CHARSET>.bin into CHR RAM: the glyph plane, its reversed copy, and nothing else.
  const charset = video.chr.default, charsetFile = `charsets/${charset.name}.bin`;
  let tiles;
  const chr = () => (tiles ??= chrTiles(readFileSync(path.join(mia.dir, charsetFile)), video.chr));
  const reversed = hexRows => Buffer.from(hexRows, 'hex').map(b => b ^ 0xff).toString('hex');
  const used = new Set([`${charset.glyphBank}/${charset.plane}`, `${charset.reverseBank}/${charset.plane}`]);
  report.same('video.json', 'chr.default.name', charset.name, () => cmakeDefault(readFileSync(path.join(mia.dir, 'CMakeLists.txt'), 'utf8'), 'MIA_CHARSET'), 'CMakeLists.txt MIA_CHARSET');
  report.same('video.json', 'chr.default.glyphs', charset.glyphs, () => chr()[charset.glyphBank][charset.plane], charsetFile);
  report.same('video.json', 'chr.default reversed glyphs', charset.glyphs.map(reversed), () => chr()[charset.reverseBank][charset.plane], charsetFile);
  report.same('video.json', 'chr.default planes with art', [...used], () => chr().flatMap((planes, bank) => planes.map((t, plane) => (t.some(g => /[^0]/.test(g)) ? `${bank}/${plane}` : null))).filter(Boolean), charsetFile);

  const audio = specs['audio.json'];
  same('audio.json', 'layoutVersion', audio.layoutVersion, 'MIA_AUDIO_VERSION');
  same('audio.json', 'voices', audio.voices, 'MIA_AUDIO_VOICE_COUNT');
  same('audio.json', 'sampleRateHz', audio.sampleRateHz, 'MIA_AUDIO_SAMPLE_RATE');
  same('audio.json', 'tickRateHz', audio.tickRateHz, 'MIA_AUDIO_TICK_RATE');
  same('audio.json', 'voiceRecordBytes', audio.voiceRecordBytes, 'MIA_AUDIO_VOICE_SIZE');
  same('audio.json', 'masterVolume.max', audio.masterVolume.max, 'MIA_AUDIO_MASTER_VOLUME_MAX');
  same('audio.json', 'masterVolume.default', audio.masterVolume.default, 'MIA_AUDIO_MASTER_VOLUME_DEFAULT');
  same('audio.json', 'voiceVolume.default', audio.voiceVolume.default, 'MIA_AUDIO_VOICE_VOLUME_DEFAULT');
  table(report, 'audio.json', audio.waveforms, e => `MIA_AUDIO_WAVE_${e.name.toUpperCase()}`, e => e.id, mia.names(/^MIA_AUDIO_WAVE_/), v);
  for (const [name, offset] of Object.entries(audio.voiceOffsets)) same('audio.json', `voiceOffsets.${name}`, offset, `MIA_AUDIO_VOICE_${name}`);
  const audioCommands = {enable: 'ENABLE', stop: 'STOP', reset: 'RESET', sequencerLoad: 'SEQ_LOAD', sequencerStart: 'SEQ_START', sequencerStop: 'SEQ_STOP', voiceTake: 'VOICE_TAKE', voiceRelease: 'VOICE_RELEASE', sequencerSetBase0: 'SEQ_SET_BASE0', sequencerSetBase1: 'SEQ_SET_BASE1', sequencerSetBase2: 'SEQ_SET_BASE2', sequencerSetBase3: 'SEQ_SET_BASE3'};
  for (const [name, id] of Object.entries(audio.commands)) {
    if (!audioCommands[name]) { report.fail('audio.json', `commands.${name} has no MIA command name in check-drift.mjs`); continue; }
    same('audio.json', `commands.${name}`, hex(id), `MIA_CMD_AUDIO_${audioCommands[name]}`);
  }
  table(report, 'audio.json', audio.sequencer.opcodes, e => `MIA_SEQ_OP_${e.name}`, e => e.id, mia.names(/^MIA_SEQ_OP_/), v);
  for (const e of audio.sequencer.opcodes) romCopies(report, 'audio.json', rom, `MIA_SEQ_OP_${e.name}`, e.id);
  same('audio.json', 'sequencer.decodeBudgetOpcodes', audio.sequencer.decodeBudgetOpcodes, 'MIA_SEQ_DECODE_BUDGET');
  same('audio.json', 'sequencer.catchupBudgetEvents', audio.sequencer.catchupBudgetEvents, 'MIA_SEQ_CATCHUP_BUDGET');
  same('audio.json', 'sequencer.status.runningBit', bit(audio.sequencer.status.runningBit), 'MIA_AUDIO_SEQ_STATUS_RUNNING');
  same('audio.json', 'sequencer.status.takenBit', bit(audio.sequencer.status.takenBit), 'MIA_AUDIO_SEQ_STATUS_TAKEN');
  same('audio.json', 'sequencer.doneIrqBit', bit(audio.sequencer.doneIrqBit), 'IRQ_AUDIO_SEQ_DONE');

  const input = specs['input.json'];
  table(report, 'input.json', input.modes, e => `MIA_INPUT_MODE_${e.name.toUpperCase().replace(/-/g, '_')}`, e => e.id, mia.names(/^MIA_INPUT_MODE_/, /input\/input\.h$/), v);
  for (const e of input.status.bits) {
    same('input.json', `status ${e.name}`, bit(e.bit), e.name);
    romCopies(report, 'input.json', rom, e.name.replace(/^INPUT_/, 'INPUT_STATUS_'), bit(e.bit));
  }
  same('input.json', 'textFifo.size', input.textFifo.size, 'MIA_INPUT_TEXT_FIFO_SIZE');
  same('input.json', 'wifi.udpPort', input.wifi.udpPort, 'MIA_INPUT_UDP_PORT');
  const inputRegions = [['KEYBOARD_BITMAP', 'MIA_INPUT_KEYBOARD_BITMAP_OFFSET'], ['CONSUMER_BITMAP', 'MIA_INPUT_CONSUMER_BITMAP_OFFSET'], ['MOUSE_STATE', 'MIA_INPUT_MOUSE_STATE_OFFSET'], ['INPUT_CONTROL', 'MIA_INPUT_CONTROL_OFFSET'], ['CLOCK_MS', 'MIA_CLOCK_SNAPSHOT_OFFSET']];
  for (let n = 0; n < 4; n++) inputRegions.push([`GAMEPAD_${n}`, `MIA_INPUT_GAMEPAD_OFFSET + ${n} * GAMEPAD_SLOT_SIZE`]);
  for (const [name, expr] of inputRegions) report.same('input.json', `regions ${name} start`, region(input.regions, name)?.start, () => evaluate(expr, mia.macros), expr);
  same('input.json', 'regions KEYBOARD_BITMAP hidUsagePage', region(input.regions, 'KEYBOARD_BITMAP')?.hidUsagePage, 'HID_PAGE_KEYBOARD');
  same('input.json', 'regions CONSUMER_BITMAP hidUsagePage', region(input.regions, 'CONSUMER_BITMAP')?.hidUsagePage, 'HID_PAGE_CONSUMER');
  same('input.json', 'gamepads.recordBytes', input.gamepads.recordBytes, 'GAMEPAD_SLOT_SIZE');
  same('input.json', 'clock.tiModulo', input.clock.tiModulo, 'MIA_CLOCK_TICKS_PER_DAY');
  same('input.json', 'clock.snapshotCommand', input.clock.snapshotCommand, 'MIA_CMD_CLOCK_SNAPSHOT');
  same('input.json', 'clock.setTiCommand', input.clock.setTiCommand, 'MIA_CMD_CLOCK_SET_TI');

  const storage = specs['storage.json'];
  same('storage.json', 'protocolVersion', storage.protocolVersion, 'MIA_SD_VERSION');
  same('storage.json', 'maxFileHandles', storage.maxFileHandles, 'MIA_SD_MAX_HANDLES');
  same('storage.json', 'sectorBytes', storage.sectorBytes, 'MIA_SD_SECTOR_SIZE');
  for (const [name, prefix] of [['CONTROL', 'MIA_SD_CONTROL'], ['SECTOR_BUFFER', 'MIA_SD_SECTOR'], ['PATH', 'MIA_FS_PATH'], ['DIR_ENTRY', 'MIA_FS_DIR_ENTRY'], ['TRANSFER', 'MIA_FS_TRANSFER'], ['PATH2', 'MIA_FS_PATH2']]) {
    same('storage.json', `regions ${name} start`, region(storage.regions, name)?.start, `${prefix}_OFFSET`);
    same('storage.json', `regions ${name} size`, region(storage.regions, name)?.size, `${prefix}_SIZE`);
  }
  same('storage.json', 'fileInfoCommand', hex(storage.fileInfoCommand), 'MIA_CMD_FS_FILE_INFO');
  same('storage.json', 'loadPartCommand.id', hex(storage.loadPartCommand.id), 'MIA_CMD_FS_LOAD_PART');
  const part = storage.loadPartCommand.fields, field = s => hex(/\(\$([0-9A-F]+)/.exec(s)?.[1] ?? s);
  for (const [name, macro] of [['offset', 'MIA_SD_CONTROL_PART_OFFSET0'], ['rows', 'MIA_SD_CONTROL_PART_ROWS_L'], ['fileStride', 'MIA_SD_CONTROL_PART_FILE_STRIDE0'], ['ramStride', 'MIA_SD_CONTROL_PART_RAM_STRIDE_L'], ['bytesPerRow', 'MIA_SD_CONTROL_TRANSFER_LEN0'], ['destination', 'MIA_SD_CONTROL_DEST_ADDR_L']]) {
    same('storage.json', `loadPartCommand.fields.${name}`, field(part[name]), macro);
  }

  // Registers: the ROM's kernel.inc is the copy that uses the spec's names.
  for (const r of specs['mia-registers.json'].registers.filter(r => !r.name.startsWith('RESERVED_'))) {
    report.same('mia-registers.json', r.name, r.address, () => {
      const base = r.name.replace(/_[LH]$/, '');
      if (rom.find(r.name, 'kernel')) return rom.value(r.name, 'kernel');
      if (r.name.endsWith('_L') && rom.find(base, 'kernel')) return rom.value(base, 'kernel');
      if (r.name.endsWith('_H') && rom.find(`${base}_L`, 'kernel')) return rom.value(`${base}_L`, 'kernel') + 1;
      if (r.name.endsWith('_H') && rom.find(base, 'kernel')) return rom.value(base, 'kernel') + 1;
      throw Error('the ROM kernel does not name it');
    }, 'the ROM kernel (kernel.inc)');
  }
  same('mia-registers.json', 'MIA_CTX depth', specs['mia-registers.json'].registers.find(r => r.name === 'MIA_CTX')?.depth, 'MIA_CTX_DEPTH');

  // mia.inc: every name it takes from MIA must still be MIA's, with MIA's value, and the groups it
  // lists in full must not miss a name MIA adds.
  const generated = new Set();
  for (const section of miaSections(specs)) {
    const file = /[\w-]+\.json/.exec(section.title)?.[0] ?? 'mia.inc';
    for (const s of section.symbols) {
      generated.add(s.name);
      if (s.mia === 'must' || (s.mia === 'maybe' && mia.macros.has(s.name))) same(file, `${s.name} (mia.inc)`, s.value, s.name);
    }
  }
  const checkedElsewhere = new Set(['MIA_AUDIO_VOICE_VOLUME_DEFAULT', 'MIA_CTX_DEPTH']);
  for (const [prefix, file] of [['MIA_CTX_', 'mia-registers.json'], ['MIA_AUDIO_HEADER_', 'audio.json'], ['MIA_AUDIO_STATUS_', 'audio.json'], ['MIA_AUDIO_FLAG_', 'audio.json'], ['MIA_AUDIO_VOICE_', 'audio.json'], ['MIA_AUDIO_CONTROL_', 'audio.json'],
    ['MIA_SD_CONTROL_', 'storage.json'], ['MIA_SD_STATUS_', 'storage.json'], ['MIA_SD_CARD_', 'storage.json'], ['MIA_FS_OPEN_', 'storage.json'], ['MIA_FS_DIR_', 'storage.json']]) {
    for (const [name, header] of mia.names(new RegExp(`^${prefix}`))) if (!generated.has(name) && !checkedElsewhere.has(name)) report.extra(file, name, header);
  }
}

/** The ROM keeps a committed copy of mia.inc; it must be exactly what the specs generate. */
export function checkRomInclude(report, specs, romDir) {
  const rel = 'src/include/mia.inc';
  report.same('mia.inc', `the ROM's ${rel}`, true, () => {
    let text;
    try { text = readFileSync(path.join(romDir, rel), 'utf8'); } catch { throw Error('is missing'); }
    if (text !== renderMiaInc(specs)) throw Error('differs from what the specs generate; run npm run generate:includes and copy packages/runtime/asm/mia.inc there');
    return true;
  }, 'clementina-rom');
}

export function checkRom(report, specs, rom) {
  const abi = specs['kernel-abi.json'], jump = rom.segments.find(s => s.name === 'JUMPTAB');
  report.same('kernel-abi.json', 'base', abi.base, () => rom.value('KERN_BASE', 'kernel'), 'kernel.inc KERN_BASE');
  report.same('kernel-abi.json', 'jump table size', abi.entries.length * abi.entrySize, () => rom.value('KERN_JUMPTAB_SIZE', 'kernel'), 'kernel.inc KERN_JUMPTAB_SIZE');
  report.same('kernel-abi.json', 'JUMPTAB segment', {start: abi.base, size: abi.entries.length * abi.entrySize}, jump && {start: jump.start, size: jump.size}, 'the ROM build');
  const tableEnd = abi.base + (rom.find('KERN_JUMPTAB_SIZE', 'kernel')?.value ?? abi.entries.length * abi.entrySize);
  const kern = new Map(rom.symbols.filter(s => s.module === 'kernel' && s.type === 'equ' && /^(KERN|BAS)_/.test(s.name) && s.name !== 'KERN_BASE' && s.value >= abi.base && s.value < tableEnd).map(s => [s.name, 'kernel.inc']));
  table(report, 'kernel-abi.json', abi.entries, e => e.symbol, e => e.address, kern, name => rom.value(name, 'kernel'), 'kernel.inc');
  // A BAS_* entry is a JMP to the BASIC routine its target names.
  for (const e of abi.entries.filter(e => e.target)) report.same('kernel-abi.json', `${e.symbol} target`, e.target, () => {
    const to = jmpOperand(rom.bin, rom.segments, e.address);
    return rom.find(e.target, 'basic')?.value === to ? e.target : `$${to.toString(16).toUpperCase()}`;
  }, 'the ROM build');

  const map = specs['cpu-memory-map.json'];
  report.same('cpu-memory-map.json', 'image.start', map.image.start, () => rom.label('__KERNEL_START__'), 'kernel.lbl');
  report.same('cpu-memory-map.json', 'image.kernelRegionEndExclusive', map.image.kernelRegionEndExclusive, () => rom.label('__KERNEL_START__') + rom.label('__KERNEL_SIZE__'), 'kernel.lbl');
  report.same('cpu-memory-map.json', 'image.heapEndExclusive', map.image.heapEndExclusive, () => rom.label('__BASICMEM_START__') + rom.label('__BASICMEM_SIZE__'), 'kernel.lbl');
  for (const [key, name] of Object.entries(map.image.buildSymbols)) report.same('cpu-memory-map.json', `image.buildSymbols.${key}`, true, () => (rom.label(name), true), 'kernel.lbl');
  const zp = map.pages.find(p => p.name === 'ZERO_PAGE'), zpBlock = name => zp.blocks.find(b => b.name === name);
  report.same('cpu-memory-map.json', 'zero page BASIC block', [zpBlock('BASIC')?.start, zpBlock('BASIC')?.size], () => [rom.label('__BASICZP_START__'), rom.label('__BASICZP_SIZE__')], 'kernel.lbl BASICZP');
  report.same('cpu-memory-map.json', 'zero page KERNEL block', [zpBlock('KERNEL')?.start, zpBlock('KERNEL')?.size], () => [rom.label('__KZP_START__'), rom.label('__KZP_SIZE__')], 'kernel.lbl KZP');
  report.same('cpu-memory-map.json', 'zero page PROGRAMS block', [zpBlock('PROGRAMS')?.start, zpBlock('PROGRAMS')?.endExclusive], () => [rom.value('ZP_FREE_START', 'kernel'), rom.value('ZP_FREE_END', 'kernel') + 1], 'kernel.inc ZP_FREE_START/END');
  const blockStart = (page, block) => map.pages.find(p => p.name === page)?.blocks.find(b => b.name === block)?.start;
  report.same('cpu-memory-map.json', 'CLOCK_SNAPSHOT block', blockStart('INPUT_PAGE', 'CLOCK_SNAPSHOT'), () => rom.value('CLOCK_SNAPSHOT', 'kernel'), 'kernel.inc');
  report.same('cpu-memory-map.json', 'KERNEL_VARIABLES block', blockStart('KERNEL_VARIABLES', 'KERNEL_VARIABLES'), () => rom.value('KVARS', 'kernel'), 'kernel.inc');
  for (const page of map.pages) for (const l of page.locations.filter(l => l.name)) {
    const module = l.owner === 'wozmon' ? 'wozmon' : l.owner === 'basic' ? 'basic' : 'kernel';
    for (const named of [l, ...(l.aliases ?? [])]) report.same('cpu-memory-map.json', `${named.name}`, named.address, () => rom.value(named.name, module), `the ROM's ${module} module`);
  }
  report.same('cpu-memory-map.json', 'via.base', map.via.base, () => rom.value('VIA_BASE', 'kernel'), 'kernel.inc');
  for (const r of map.via.registers) if (rom.find(r.name, 'kernel')) report.same('cpu-memory-map.json', `via ${r.name}`, r.address, rom.value(r.name, 'kernel'), 'kernel.inc');
  report.same('cpu-memory-map.json', 'extendedRam.banks', map.extendedRam.banks, () => 2 ** rom.value('VIA_DDRA_BANK_BITS', 'kernel').toString(2).replace(/0/g, '').length, 'kernel.inc VIA_DDRA_BANK_BITS');
  for (const e of specs['mia-indexes.json'].ids.filter(e => e.owner === 'kernel' && e.name)) report.same('mia-indexes.json', e.name, e.id, () => rom.value(e.name, 'kernel'), 'kernel.inc');
  const kidx = rom.symbols.filter(s => s.module === 'kernel' && /^KIDX_/.test(s.name)).map(s => s.name);
  for (const name of kidx) if (!specs['mia-indexes.json'].ids.some(e => e.name === name)) report.extra('mia-indexes.json', name, 'kernel.inc');

  const basic = specs['basic.json'], t = basic.tokens;
  const names = (start, end) => () => nameTable(rom.bin, rom.segments, rom.value(start, 'basic'), end ? rom.value(end, 'basic') : undefined);
  report.same('basic.json', 'tokens.primary', t.primary, names('TOKEN_NAME_TABLE'), 'the ROM build (TOKEN_NAME_TABLE)');
  report.same('basic.json', 'tokens.extension', t.extension, names('EXT_NAME_TABLE', 'EXT_NAME_TABLE_END'), 'the ROM build (EXT_NAME_TABLE)');
  report.same('basic.json', 'tokens.extension2', t.extension2, names('EXT2_NAME_TABLE', 'EXT2_NAME_TABLE_END'), 'the ROM build (EXT2_NAME_TABLE)');
  report.same('basic.json', 'tokens.extensionFunction', t.extensionFunction, names('EXTFN_NAME_TABLE', 'EXTFN_NAME_TABLE_END'), 'the ROM build (EXTFN_NAME_TABLE)');
  for (const [key, name] of [['extensionPrefix', 'TOKEN_EXT'], ['extension2Prefix', 'TOKEN_EXT2'], ['extensionFunctionPrefix', 'TOKEN_EXTFN']]) report.same('basic.json', `tokens.${key}`, t[key], () => rom.value(name, 'basic'), `token.s ${name}`);
  report.same('basic.json', 'tokens.special.MON', t.special.MON, () => rom.value('TOKEN_MON', 'basic'), 'token.s TOKEN_MON');
  for (const [key, name] of [['statementBoundaryAddress', 'NEWSTT2'], ['currentLineAddress', 'CURLIN'], ['variableTablePointerAddress', 'VARTAB']]) report.same('basic.json', `runtimeDebug.${key}`, basic.runtimeDebug[key], () => rom.value(name, 'basic'), `the ROM build (${name})`);

  const errors = basic.errors, text = name => () => cString(rom.bin, rom.segments, rom.value(name, 'basic')).replace(/[\r\n]/g, '');
  report.same('basic.json', 'errors.entries messages', errors.entries.map(e => e.message), names('ERROR_MESSAGES'), 'the ROM build (ERROR_MESSAGES)');
  const errNames = new Map(rom.symbols.filter(s => s.module === 'basic' && /^ERR_/.test(s.name)).map(s => [s.name, 'error.s']));
  table(report, 'basic.json', errors.entries, e => e.name, e => e.code, errNames, name => rom.value(name, 'basic'), 'error.s');
  for (const m of errors.messages) report.same('basic.json', `errors.messages ${m.name}`, m.text, text(m.name), `the ROM build (${m.name})`);
  for (const [key, name] of [['suffix', 'QT_ERROR'], ['inLine', 'QT_IN'], ['ready', 'QT_OK']]) report.same('basic.json', `errors.format.${key}`, errors.format[key], text(name), `message.s ${name}`);

  for (const k of specs['video.json'].chr.default.kernelTiles) report.same('video.json', `chr.default.kernelTiles ${k.name}`, k.code, () => rom.value(k.name, 'kernel'), 'kernel.inc');
}

// ---------------------------------------------------------------------------------------------
// Main

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8'}).trim();

function main(argv) {
  const option = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? path.resolve(argv[i + 1]) : fallback; };
  const miaDir = option('--mia', path.resolve(sdkRoot, '..', 'clementina-mia'));
  const romDir = option('--rom', path.resolve(sdkRoot, '..', 'clementina-rom'));
  for (const [name, dir, flag] of [['clementina-mia', miaDir, '--mia'], ['clementina-rom', romDir, '--rom']]) {
    try { statSync(path.join(dir, '.git')); } catch { throw Error(`${name} is not checked out at ${dir}; clone it next to the SDK or pass ${flag} DIR.`); }
  }
  const files = readdirSync(path.join(sdkRoot, 'specs')).filter(f => f.endsWith('.json'));
  const specs = Object.fromEntries(files.map(f => [f, JSON.parse(readFileSync(path.join(sdkRoot, 'specs', f), 'utf8'))]));
  const report = new Report(), mia = new MiaSource(miaDir), rom = new RomBuild(buildRom(romDir));
  checkMia(report, specs, mia, rom);
  checkRom(report, specs, rom);
  checkRomInclude(report, specs, romDir);

  const repos = [['clementina-mia', miaDir], ['clementina-rom', romDir]].map(([name, dir]) => ({name, dir, commit: git(dir, 'rev-parse', 'HEAD'), dirty: git(dir, 'status', '--porcelain') !== ''}));
  console.log(`Clementina spec drift: ${report.checked} values checked against ${repos.map(r => `${r.name} ${r.commit.slice(0, 7)}${r.dirty ? ' (uncommitted changes)' : ''}`).join(' and ')}.`);
  if (report.problems.length) {
    console.error(`${report.problems.length} mismatch${report.problems.length === 1 ? '' : 'es'}:`);
    for (const p of report.problems) console.error(`- ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('Specs match the sources.');
  if (argv.includes('--record')) {
    if (repos.some(r => r.dirty)) throw Error('Not recording: a checkout has uncommitted changes, so its commit is not what was checked.');
    const manifestPath = path.join(sdkRoot, 'specs', 'source-manifest.json'), manifest = specs['source-manifest.json'];
    manifest.verifiedAt = new Date().toISOString().slice(0, 10);
    for (const r of repos) manifest.repositories.find(m => m.name === r.name).commit = r.commit;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Recorded ${repos.map(r => `${r.name} ${r.commit.slice(0, 7)}`).join(' and ')} in specs/source-manifest.json.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
