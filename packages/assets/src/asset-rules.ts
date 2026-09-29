import {diagnostic, type ClementinaDiagnostic} from '@clementina/core';
import type {PortableAsset} from './validate.js';

const TILESET_COLUMNS = 16, TILESET_ROWS = 16;
const OVERLAY_COLUMNS = 40, OVERLAY_ROWS = 25;
const MAX_BACKGROUND_CELLS = 200000;

/** Check constraints that the portable JSON schemas cannot express. */
export function assetRuleDiagnostics(asset: PortableAsset): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  if (!asset.name.trim()) diagnostics.push(diagnostic('asset.name', '/name', 'Name must not be blank'));

  switch (asset.format) {
    case 'clementina-tileset': {
      const names = new Set<string>();
      asset.authoring.compositions.forEach((composition, index) => {
        const path = `/authoring/compositions/${index}`;
        if (!composition.name.trim() || names.has(composition.name)) diagnostics.push(diagnostic('asset.composition.name', `${path}/name`, 'Composition names must be unique and non-empty'));
        names.add(composition.name);
        if (composition.x + composition.width > TILESET_COLUMNS || composition.y + composition.height > TILESET_ROWS) diagnostics.push(diagnostic('asset.composition.bounds', path, 'Composition lies outside the tileset'));
      });
      break;
    }
    case 'clementina-background':
      if (asset.cells.length !== asset.width * asset.height) diagnostics.push(diagnostic('asset.background.cells', '/cells', 'Cell count must equal width times height'));
      if (asset.width * asset.height > MAX_BACKGROUND_CELLS) diagnostics.push(diagnostic('asset.background.size', '/cells', 'A background may hold at most 200000 cells'));
      break;
    case 'clementina-overlay':
      diagnostics.push(...placeholderDiagnostics(asset.placeholders));
      break;
    case 'clementina-song':
      if (asset.loopStart !== undefined && asset.loopStart >= asset.length) diagnostics.push(diagnostic('asset.song.loop', '/loopStart', 'The loop starts outside the song'));
      asset.voices.forEach((voice, voiceIndex) => {
        let end = 0;
        voice.notes.forEach((note, noteIndex) => {
          const path = `/voices/${voiceIndex}/notes/${noteIndex}`;
          if (note.step + note.length > asset.length) diagnostics.push(diagnostic('asset.song.note', path, 'A note runs past the end of the song'));
          if (note.step < end) diagnostics.push(diagnostic('asset.song.overlap', path, 'Notes on one voice overlap or are out of order'));
          end = Math.max(end, note.step + note.length);
        });
      });
      break;
  }
  return diagnostics;
}

type Placeholder = {id: string; name: string; col: number; row: number; width: number; height: number};

/** Check placeholder identities, grid bounds, and pairwise overlap. */
function placeholderDiagnostics(placeholders: readonly Placeholder[]): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  const ids = new Set<string>(), names = new Set<string>();
  placeholders.forEach((placeholder, index) => {
    const path = `/placeholders/${index}`;
    if (ids.has(placeholder.id)) diagnostics.push(diagnostic('asset.placeholder.id', `${path}/id`, 'Placeholder ids must be unique'));
    ids.add(placeholder.id);
    if (!placeholder.name.trim() || names.has(placeholder.name.toLowerCase())) diagnostics.push(diagnostic('asset.placeholder.name', `${path}/name`, 'Placeholder names must be unique and non-empty'));
    names.add(placeholder.name.toLowerCase());
    if (placeholder.col + placeholder.width > OVERLAY_COLUMNS || placeholder.row + placeholder.height > OVERLAY_ROWS) diagnostics.push(diagnostic('asset.placeholder.bounds', path, 'Placeholder lies outside the 40 x 25 overlay grid'));
  });
  placeholders.forEach((first, firstIndex) => placeholders.forEach((second, secondIndex) => {
    if (secondIndex <= firstIndex) return;
    const overlaps = first.col < second.col + second.width && second.col < first.col + first.width
      && first.row < second.row + second.height && second.row < first.row + first.height;
    if (overlaps) diagnostics.push(diagnostic('asset.placeholder.overlap', `/placeholders/${secondIndex}`, `Placeholder "${second.name}" overlaps "${first.name}"`));
  }));
  return diagnostics;
}
