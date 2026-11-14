/**
 * Portable-source `{…}` tags for what the screen editor stores in strings that
 * printable ASCII cannot spell: glyph bytes, and the per-character attributes
 * of a quoted string's style sidecar. specs/basic.json `sourceNotation` is the
 * contract.
 */

/** Overlay attribute bits a style tag can set: palette bank 0-15 in bits 0-3. */
export const BASIC_STYLE_COLOR_MASK = 0x0f;
export const BASIC_STYLE_FLIP_X = 0x10;
export const BASIC_STYLE_FLIP_Y = 0x20;
/** CHR_ALT: the cell draws from the reversed charset bank. */
export const BASIC_STYLE_REVERSE = 0x80;
/** BASIC's internal raw-tile marker (STRING_RAW_TILE) in a stored string attribute; it reuses the overlay priority bit. */
export const BASIC_STYLE_RAW_TILE = 0x40;

/** Style-tag words for the flag bits, in canonical order after the color word. */
export const basicStyleFlags: readonly {word: string; bit: number; label: string}[] = [
  {word: 'fx', bit: BASIC_STYLE_FLIP_X, label: 'flip X'},
  {word: 'fy', bit: BASIC_STYLE_FLIP_Y, label: 'flip Y'},
  {word: 'rev', bit: BASIC_STYLE_REVERSE, label: 'reverse'},
];

export type BasicTag = {kind: 'style'; attribute: number} | {kind: 'character'; code: number};

/** True for a character the screen editor tags with the raw-tile bit: one outside printable $20-$7E. */
export function isBasicRawTile(code: number): boolean {
  return code < 0x20 || code > 0x7e;
}

/** Format a byte as two uppercase hex digits. */
function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/** Parse the text between a tag's braces, or explain why it is not a tag. */
export function parseBasicTag(content: string): BasicTag | {error: string} {
  const words = content.trim().split(/\s+/u).filter(word => word !== '');
  if (words.length === 0) return {error: 'empty {} tag: write {$hh} for a character or style words such as {c2 fy}'};
  if (words.some(word => word.startsWith('$'))) {
    if (words.length > 1) return {error: 'a tag holds one character ({$hh}) or style words, not both'};
    const match = /^\$([0-9A-Fa-f]{2})$/u.exec(words[0]!);
    if (!match) return {error: `character tags take two hex digits, as in {$81}, not {${words[0]}}`};
    const code = Number.parseInt(match[1]!, 16);
    if (code === 0) return {error: 'tile $00 cannot be stored: $00 ends a tokenized line'};
    if (code === 0x22) return {error: 'tile $22 is the quote character: type " instead (inside a quoted string it ends the string)'};
    return {kind: 'character', code};
  }
  let attribute = 0, color = false;
  for (const word of words.map(item => item.toLowerCase())) {
    const colorMatch = /^c([0-9]+)$/u.exec(word);
    if (colorMatch) {
      const bank = Number(colorMatch[1]);
      if (bank > BASIC_STYLE_COLOR_MASK) return {error: `color must be c0..c15, not ${word}`};
      if (color) return {error: `a style tag takes one color, found a second one: ${word}`};
      color = true;
      attribute |= bank;
      continue;
    }
    const flag = basicStyleFlags.find(item => item.word === word);
    if (!flag) return {error: `unknown style word '${word}': use c0-c15, fx, fy and rev, or {$hh} for a character`};
    if (attribute & flag.bit) return {error: `repeated style word '${word}'`};
    attribute |= flag.bit;
  }
  return {kind: 'style', attribute};
}

/** Write the canonical style tag for an overlay attribute byte, ignoring the raw-tile bit. */
export function formatBasicStyleTag(attribute: number): string {
  const words = [`c${attribute & BASIC_STYLE_COLOR_MASK}`, ...basicStyleFlags.filter(flag => attribute & flag.bit).map(flag => flag.word)];
  return `{${words.join(' ')}}`;
}

/** Write one stored byte as source: printable ASCII as itself, and `{` and every other byte as a `{$hh}` tag. */
export function formatBasicCharacter(code: number): string {
  return isBasicRawTile(code) || code === 0x7b ? `{$${hex2(code)}}` : String.fromCharCode(code);
}
