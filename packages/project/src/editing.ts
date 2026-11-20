import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, type Document} from 'yaml';
import type {ClementinaDiagnostic} from '@clementina/core';
import {loadProject} from './node.js';

/** A zero-based place in the manifest's text. */
export interface ManifestPosition {line: number; character: number}
/** A diagnostic placed on the manifest's text, for an editor. */
export interface ManifestDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  start: ManifestPosition;
  end: ManifestPosition;
}

/** The fields an address or size may be written in hex for, as JSON pointers with slots' indexes removed. */
const ADDRESS_FIELD = /^\/build\/(?:assembly\/loadAddress|basic\/memoryTop|assets\/slots\/\d+\/(?:mia|address|size))$/u;

/**
 * Check a manifest's text as `clementina build` would, with each diagnostic on
 * the text it is about. Schema errors are left to the editor's own schema
 * check (the YAML extension reads specs/schema/project.schema.json), except an
 * out-of-range hex address, which the schema cannot see. A diagnostic about
 * another file (an asset, a source) is placed on the path that names it.
 */
export async function checkManifestText(root: string, text: string): Promise<ManifestDiagnostic[]> {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {uniqueKeys: true, lineCounter});
  const at = (offset: number): ManifestPosition => {
    const {line, col} = lineCounter.linePos(Math.min(Math.max(offset, 0), text.length));
    return {line: line - 1, character: col - 1};
  };
  if (doc.errors.length) return doc.errors.map(error => ({
    severity: 'error', code: 'project.yaml', message: error.message,
    start: at(error.pos[0]), end: at(Math.max(error.pos[1], error.pos[0] + 1)),
  }));
  const loaded = await loadProject(root, {manifestText: text});
  const out: ManifestDiagnostic[] = [];
  for (const d of loaded.diagnostics) {
    const placed = place(doc, d, text);
    if (!placed) continue;
    out.push({severity: d.severity === 'warning' ? 'warning' : 'error', code: d.code, message: placed.message, start: at(placed.range[0]), end: at(placed.range[1])});
  }
  return out;
}

/** The text range and message for one diagnostic, or undefined to leave it to the schema check. */
function place(doc: Document, d: ClementinaDiagnostic, text: string): {range: [number, number]; message: string} | undefined {
  const source = d.source ?? 'clementina.yaml';
  if (source !== 'clementina.yaml') {
    const range = findScalar(doc, source) ?? [0, firstLineEnd(text)];
    const message = d.code === 'project.io' && /ENOENT/u.test(d.message) ? 'No such file in the project' : d.message;
    return {range, message: `${source}${d.path ? ` ${d.path}` : ''}: ${message}`};
  }
  const keys = (d.path ?? '').split('/').slice(1).map(key => (/^\d+$/u.test(key) ? Number(key) : key));
  if (d.code.startsWith('schema.')) {
    const raw = doc.getIn(keys);
    if (!(typeof raw === 'string' && ADDRESS_FIELD.test(d.path ?? ''))) return undefined;
  }
  return {range: rangeOf(doc, keys, text) ?? [0, firstLineEnd(text)], message: d.message};
}

/**
 * Where a JSON pointer points in the text: a scalar's value, a map's or list's
 * key (`build:`), or the nearest ancestor that exists.
 */
function rangeOf(doc: Document, keys: (string | number)[], text: string): [number, number] | undefined {
  const lineOf = (node: {range?: [number, number, number] | null}): [number, number] | undefined => {
    if (!node.range) return undefined;
    const end = text.indexOf('\n', node.range[0]);
    return [node.range[0], Math.min(node.range[1], end < 0 ? text.length : end)];
  };
  for (let n = keys.length; n >= 1; n--) {
    const parent = n === 1 ? doc.contents : doc.getIn(keys.slice(0, n - 1), true);
    const key = keys[n - 1];
    if (isMap(parent)) {
      const pair = parent.items.find(item => (isScalar(item.key) ? item.key.value : item.key) === key);
      if (!pair) continue;
      if (isScalar(pair.value) && pair.value.range) return [pair.value.range[0], pair.value.range[1]];
      if (isNode(pair.key)) return lineOf(pair.key);
    } else if (isSeq(parent) && typeof key === 'number') {
      const item = parent.items[key];
      if (isNode(item)) return isScalar(item) && item.range ? [item.range[0], item.range[1]] : lineOf(item);
    }
  }
  return isNode(doc.contents) ? lineOf(doc.contents) : undefined;
}

/** The first scalar in the manifest whose value is text. */
function findScalar(doc: Document, value: string): [number, number] | undefined {
  let found: [number, number] | undefined;
  const visit = (node: unknown): void => {
    if (found || !isNode(node)) return;
    if (isScalar(node)) { if (node.value === value && node.range) found = [node.range[0], node.range[1]]; return; }
    const items = (node as {items?: unknown[]}).items ?? [];
    for (const item of items) {
      if (item && typeof item === 'object' && 'value' in item && !isNode(item)) visit((item as {value: unknown}).value);
      else visit(item);
    }
  };
  visit(doc.contents);
  return found;
}

const firstLineEnd = (text: string): number => { const n = text.indexOf('\n'); return n < 0 ? text.length : n; };

/** The manifest fields that hold paths, and what each one names. */
export type ManifestPathField = {key: string; kind: 'file' | 'directory'; suffix?: string};
const PATH_FIELDS: Record<string, ManifestPathField> = {
  'program.entry': {key: 'program.entry', kind: 'file', suffix: '.cbas'},
  'build.assembly.sources': {key: 'build.assembly.sources', kind: 'file', suffix: '.s'},
  'build.assembly.linkerConfig': {key: 'build.assembly.linkerConfig', kind: 'file', suffix: '.cfg'},
  'build.assembly.includeDirectories': {key: 'build.assembly.includeDirectories', kind: 'directory'},
  'assets.palettes': {key: 'assets.palettes', kind: 'file', suffix: '.palette.json'},
  'assets.paletteConfigs': {key: 'assets.paletteConfigs', kind: 'file', suffix: '.palette-config.json'},
  'assets.tilesets': {key: 'assets.tilesets', kind: 'file', suffix: '.tileset.json'},
  'assets.backgrounds': {key: 'assets.backgrounds', kind: 'file', suffix: '.background.json'},
  'assets.overlays': {key: 'assets.overlays', kind: 'file', suffix: '.overlay.json'},
  'assets.shapes': {key: 'assets.shapes', kind: 'file', suffix: '.shape.json'},
  'assets.animations': {key: 'assets.animations', kind: 'file', suffix: '.animation.json'},
  'assets.instruments': {key: 'assets.instruments', kind: 'file', suffix: '.instrument.json'},
  'assets.sounds': {key: 'assets.sounds', kind: 'file', suffix: '.sound.json'},
  'assets.songs': {key: 'assets.songs', kind: 'file', suffix: '.song.json'},
};

/**
 * The path field the cursor is in, from the indentation of the lines above it:
 * a `- item` under `tilesets:`, or the value after `entry:`. Block-style YAML only.
 */
export function manifestPathFieldAt(text: string, line: number, character: number): ManifestPathField | undefined {
  const lines = text.split(/\r?\n/u);
  const current = (lines[line] ?? '').slice(0, character);
  const indent = (s: string): number => s.length - s.trimStart().length;
  const keyOf = (s: string): string | undefined => /^\s*(?:-\s+)?([A-Za-z][A-Za-z0-9]*)\s*:/u.exec(s)?.[1];
  const chain: string[] = [];
  let limit: number;
  const item = /^\s*-\s*\S*$/u.test(current);
  const own = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*\S*$/u.exec(current);
  if (own) { chain.unshift(own[1]!); limit = indent(current); }
  else if (item) limit = indent(current) + 1;
  else return undefined;
  for (let i = line - 1; i >= 0 && limit > 0; i--) {
    const text = lines[i]!;
    if (!text.trim() || text.trimStart().startsWith('#')) continue;
    const key = keyOf(text), level = indent(text);
    if (key && level < limit) { chain.unshift(key); limit = level; }
  }
  return PATH_FIELDS[chain.join('.')];
}

/** Folders a project's path completion never offers. */
const SKIPPED = new Set(['node_modules', '.git', '.vscode']);

/** Project-relative paths that fit a path field, skipping the build output and hidden folders. */
export async function manifestPathCandidates(root: string, field: ManifestPathField, outputDirectory = 'build'): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > 6 || found.length >= 500) return;
    let entries;
    try { entries = await readdir(join(root, relative), {withFileTypes: true}); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name) || path === outputDirectory) continue;
      if (entry.isDirectory()) {
        if (field.kind === 'directory') found.push(path);
        await walk(path, depth + 1);
      } else if (entry.isFile() && field.kind === 'file' && entry.name.toLowerCase().endsWith(field.suffix ?? '')) found.push(path);
    }
  };
  await walk('', 0);
  return found;
}
