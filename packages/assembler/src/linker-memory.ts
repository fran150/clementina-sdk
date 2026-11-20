/**
 * The little the build needs from an ld65 configuration's MEMORY block: each
 * area's output file and its `bank` attribute. ld65 itself checks the whole
 * file; this reader only has to find those two attributes.
 */

export interface LinkerMemoryArea {
  name: string;
  /** The output file with `%O` replaced by ld65's `-o` name, or `''` for no output. */
  file?: string;
  /** The `bank` attribute, when it is a plain number (what ca65's `.bank()` gives its labels). */
  bank?: number;
}

/** Split a configuration into its tokens: strings, `%O`-style specials, words and punctuation. */
function tokens(text: string): string[] {
  const out: string[] = [];
  const pattern = /#[^\n]*|"([^"\n]*)"?|%[A-Za-z]|[A-Za-z0-9_$.]+|[{}:;=,+\-*/()]|\s+|./gu;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    if (/^\s/u.test(token) || token.startsWith('#')) continue;
    out.push(token.startsWith('"') ? `"${match[1] ?? ''}` : token);
  }
  return out;
}

/** A plain ld65 number: decimal, `$hex` or `0xhex`. */
function plainNumber(text: string): number | undefined {
  if (/^\$[0-9A-Fa-f]+$/u.test(text)) return parseInt(text.slice(1), 16);
  if (/^0[xX][0-9A-Fa-f]+$/u.test(text)) return parseInt(text.slice(2), 16);
  return /^[0-9]+$/u.test(text) ? Number(text) : undefined;
}

/**
 * Read the MEMORY areas of an ld65 configuration.
 *
 * @param text - The configuration file's text.
 * @param outputName - What ld65 substitutes for `%O` (its `-o` argument).
 * @returns The areas by name, in file order.
 */
export function readLinkerMemory(text: string, outputName: string): Map<string, LinkerMemoryArea> {
  const list = tokens(text);
  const areas = new Map<string, LinkerMemoryArea>();
  for (let index = 0; index < list.length; index++) {
    if (list[index]!.toUpperCase() !== 'MEMORY' || list[index + 1] !== '{') continue;
    index += 2;
    while (index < list.length && list[index] !== '}') {
      const name = list[index]!.replace(/^"/u, '');
      if (list[index + 1] !== ':') { index++; continue; }
      index += 2;
      const area: LinkerMemoryArea = {name};
      while (index < list.length && list[index] !== ';' && list[index] !== '}') {
        const key = list[index]!.toLowerCase();
        if (list[index + 1] !== '=') { index++; continue; }
        index += 2;
        const value: string[] = [];
        while (index < list.length && ![';', '}', ','].includes(list[index]!) && list[index + 1] !== '=') value.push(list[index++]!);
        if (list[index] === ',') index++;
        if (key === 'file' && value.length === 1) {
          const token = value[0]!;
          if (token === '%O') area.file = outputName;
          else if (token.startsWith('"')) area.file = token.slice(1).replaceAll('%O', outputName);
        }
        if (key === 'bank' && value.length === 1) {
          const bank = plainNumber(value[0]!);
          if (bank !== undefined) area.bank = bank;
        }
      }
      if (list[index] === ';') index++;
      areas.set(name, area);
    }
  }
  return areas;
}
