import {Document, isMap, isScalar, isSeq, parseDocument, type Node} from 'yaml';
import {parseManifestAddress} from './validate.js';
import type {ClementinaProjectManifest} from './types.js';

/** Manifest fields that hold an address, with the hex digits a new value gets: 4 for the CPU, 5 for MIA. */
const ADDRESS_DIGITS: [RegExp, number][] = [
  [/^\/build\/assembly\/loadAddress$/u, 4],
  [/^\/build\/basic\/memoryTop$/u, 4],
  [/^\/build\/assets\/slots\/\d+\/address$/u, 4],
  [/^\/build\/assets\/slots\/\d+\/mia$/u, 5],
];
/** Fields that take hex as well as numbers, so `$2000` and 8192 are the same value. */
const HEX_FIELD = /^\/build\/(?:assembly\/loadAddress|basic\/memoryTop|assets\/slots\/\d+\/(?:mia|address|size))$/u;

/** `{machine: clementina-6502}` and `[src/a.s]`, as the starter writes flow collections. */
const FORMAT = {flowCollectionPadding: false} as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A value as it is written: addresses as `$` hex, the way the docs and memory maps write them. */
function written(value: unknown, pointer: string): unknown {
  if (Array.isArray(value)) return value.map((v, i) => written(v, `${pointer}/${i}`));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, written(v, `${pointer}/${k}`)]));
  const digits = ADDRESS_DIGITS.find(([pattern]) => pattern.test(pointer))?.[1];
  return digits !== undefined && typeof value === 'number' ? `$${value.toString(16).toUpperCase().padStart(digits, '0')}` : value;
}

/** Whether a scalar already holds the value, counting `$7000`, `0x7000` and 28672 as one address. */
function sameScalar(node: Node, value: unknown, pointer: string): boolean {
  if (!isScalar(node)) return false;
  if (node.value === value) return true;
  return HEX_FIELD.test(pointer) && parseManifestAddress(node.value) === parseManifestAddress(value);
}

/** Change `node` to hold `value`, keeping every node, comment and style whose value did not change. */
function merge(doc: Document, node: Node, value: unknown, pointer: string, changes: {count: number}): Node {
  if (isMap(node) && isObject(value)) {
    for (const pair of [...node.items]) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key;
      if (typeof key !== 'string' || value[key] === undefined) { node.delete(pair.key); changes.count++; }
    }
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const existing = node.get(key, true) as Node | undefined;
      if (!existing) changes.count++;
      node.set(key, existing ? merge(doc, existing, v, `${pointer}/${key}`, changes) : doc.createNode(written(v, `${pointer}/${key}`)));
    }
    return node;
  }
  if (isSeq(node) && Array.isArray(value)) {
    value.forEach((v, i) => {
      const existing = node.get(i, true) as Node | undefined;
      if (existing) node.set(i, merge(doc, existing, v, `${pointer}/${i}`, changes));
      else { node.add(doc.createNode(written(v, `${pointer}/${i}`))); changes.count++; }
    });
    if (node.items.length > value.length) { node.items.splice(value.length); changes.count++; }
    return node;
  }
  if (sameScalar(node, value, pointer)) return node;
  changes.count++;
  const created = doc.createNode(written(value, pointer)) as Node;
  created.commentBefore = node.commentBefore;
  created.comment = node.comment;
  return created;
}

/**
 * The text of `clementina.yaml` for `manifest`. With the file's current text,
 * only the values that changed are rewritten: comments, formatting, key order
 * and hex addresses stay as they were. Values it writes new put addresses in
 * `$` hex: four digits for the CPU, five for MIA.
 */
export function manifestText(manifest: ClementinaProjectManifest, previous?: string): string {
  if (previous !== undefined) {
    const doc = parseDocument(previous, {uniqueKeys: true});
    if (!doc.errors.length && isMap(doc.contents)) {
      const changes = {count: 0};
      doc.contents = merge(doc, doc.contents, manifest, '', changes) as typeof doc.contents;
      // Unchanged, the file stays byte for byte; changed, the yaml library re-prints it with its comments.
      return changes.count ? doc.toString(FORMAT) : previous;
    }
  }
  return new Document(written(manifest, '')).toString(FORMAT);
}
