import {BASIC_STYLE_COLOR_MASK, BASIC_STYLE_FLIP_X, BASIC_STYLE_FLIP_Y, BASIC_STYLE_REVERSE} from '@clementina/basic';
import {clasciiGlyphs, consoleControlCodes, defaultInkNames, defaultPaletteColors, glyphModes} from './charset-data.js';
import type {BasicScreenPreview} from './types.js';

/** One screen cell: the stored character and its overlay attribute byte. */
export interface BasicCell {code: number; attribute: number}

/** Convert an RGB565 color to CSS `#rrggbb`. */
export function rgb565ToCss(value: number): string {
  const channel = (bits: number, max: number): string => Math.round(bits * 255 / max).toString(16).padStart(2, '0');
  return `#${channel(value >>> 11, 31)}${channel((value >>> 5) & 0x3f, 63)}${channel(value & 0x1f, 31)}`;
}

/**
 * CSS colors of a cell in the default palette: its bank's ink (color 1), and
 * color 0 behind it, which the overlay leaves transparent over the backdrop,
 * by default the same blue. Reverse swaps them.
 */
export function cellColors(attribute: number, backdrop?: string): {ink: string; background: string} {
  const bank = defaultPaletteColors[attribute & BASIC_STYLE_COLOR_MASK]!;
  const ink = rgb565ToCss(bank[1]!), behind = backdrop ?? rgb565ToCss(bank[0]!);
  return attribute & BASIC_STYLE_REVERSE ? {ink: behind, background: ink} : {ink, background: behind};
}

/** CSS color of the backdrop: the startup blue, or the ink of the bank BCOLOR picked. */
export function backdropColor(bank?: number): string {
  return rgb565ToCss(bank === undefined ? defaultPaletteColors[0]![0]! : defaultPaletteColors[bank & BASIC_STYLE_COLOR_MASK]![1]!);
}

/** The default palette's name for a bank's ink. */
export function inkName(bank: number): string {
  return defaultInkNames[bank & BASIC_STYLE_COLOR_MASK]!;
}

/** What KERN_CHROUT does instead of drawing a control code's tile, or undefined when it draws the glyph. */
export function consoleControlAction(code: number): string | undefined {
  return consoleControlCodes.find(item => item.code === code)?.action;
}

/** The lowest glyph mode and key that type a tile in the screen editor; none types $7F or $DF. */
export function glyphKeyFor(code: number): {mode: number; key: string} | undefined {
  for (let mode = 0; mode < glyphModes.count; mode++) {
    const key = (code - mode * glyphModes.step + 0x100) % 0x100;
    if (key >= glyphModes.firstKey && key <= glyphModes.lastKey) return {mode, key: String.fromCharCode(key)};
  }
  return undefined;
}

/**
 * SVG paths of rows of cells, 8 units per cell, as the overlay draws them with
 * the default charset and palette. Backgrounds the color of `backdrop` are left
 * out when `skipBackdrop` is set, for a caller that paints it once.
 */
function cellPaths(rows: readonly (readonly BasicCell[])[], backdrop?: string, skipBackdrop = false): string {
  // Every cell's background is painted before any ink, so a reversed cell's
  // glyph never ends up under a later path of the same color.
  const backgrounds = new Map<string, string>(), inks = new Map<string, string>();
  const add = (paths: Map<string, string>, color: string, d: string): void => { paths.set(color, (paths.get(color) ?? '') + d); };
  rows.forEach((cells, row) => cells.forEach((cell, index) => {
    const left = index * 8, top = row * 8;
    const {ink, background} = cellColors(cell.attribute, backdrop);
    if (!skipBackdrop || background !== backdrop) add(backgrounds, background, `M${left} ${top}h8v8h-8z`);
    const glyph = clasciiGlyphs[cell.code]!;
    for (let y = 0; y < 8; y++) {
      const source = cell.attribute & BASIC_STYLE_FLIP_Y ? 7 - y : y;
      const bits = Number.parseInt(glyph.slice(source * 2, source * 2 + 2), 16);
      let start = -1;
      for (let x = 0; x <= 8; x++) {
        const bit = cell.attribute & BASIC_STYLE_FLIP_X ? 7 - x : x;
        const lit = x < 8 && ((bits >>> bit) & 1) === 1;
        if (lit && start < 0) start = x;
        if (!lit && start >= 0) { add(inks, ink, `M${left + start} ${top + y}h${x - start}v1h-${x - start}z`); start = -1; }
      }
    }
  }));
  return [...backgrounds, ...inks].map(([color, d]) => `<path fill="${color}" d="${d}"/>`).join('');
}

/** Render cells as the overlay draws them with the default charset and palette, `cellSize` pixels per cell. */
export function renderCellsSvg(cells: readonly BasicCell[], cellSize = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cells.length * cellSize}" height="${cellSize}" viewBox="0 0 ${cells.length * 8} 8" shape-rendering="crispEdges">${cellPaths([cells])}</svg>`;
}

/** Black or white, whichever stands out more on a `#rrggbb` color. */
function contrasting(color: string): string {
  const [red, green, blue] = [1, 3, 5].map(at => Number.parseInt(color.slice(at, at + 2), 16));
  return 0.299 * red! + 0.587 * green! + 0.114 * blue! > 140 ? '#000000' : '#ffffff';
}

/**
 * Render a screen preview one pixel per screen pixel: the backdrop, the cells,
 * and a dashed outline around each placeholder run.
 */
export function renderScreenSvg(screen: BasicScreenPreview): string {
  const width = (screen.rows[0]?.length ?? 0) * 8, height = screen.rows.length * 8;
  const backdrop = backdropColor(screen.backdrop), outline = contrasting(backdrop);
  const outlines = screen.placeholders.map(run => `<rect x="${run.startColumn * 8 + 0.25}" y="${run.row * 8 + 0.25}" width="${(run.endColumn - run.startColumn) * 8 - 0.5}" height="7.5"/>`).join('');
  const placeholders = outlines && `<g fill="none" stroke="${outline}" stroke-opacity="0.8" stroke-width="0.5" stroke-dasharray="1 1">${outlines}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`
    + `<rect width="${width}" height="${height}" fill="${backdrop}"/>${cellPaths(screen.rows, backdrop, true)}${placeholders}</svg>`;
}

/** Wrap an SVG image in a base64 data URI. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
