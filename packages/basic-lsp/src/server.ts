import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  CompletionItemKind,
  CompletionTriggerKind,
  CodeActionKind,
  ErrorCodes,
  Location,
  MarkupKind,
  ResponseError,
  SemanticTokensBuilder,
  SymbolKind,
  TextEdit,
  type Diagnostic,
  type CompletionItem,
  type CodeAction,
  type Hover,
  type InitializeResult,
  type ParameterInformation,
  type SignatureHelp,
  type Range,
} from 'vscode-languageserver/node.js';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {errorMessage} from '@clementina/core';
import {basicStyleFlags, BASIC_STYLE_COLOR_MASK, formatBasicStyleTag} from '@clementina/basic';
import {
  analyzeDiagnostics,
  analyzeStrings,
  basicKeywordByName,
  cellColors,
  completionsAt,
  consoleControlAction,
  definitionAt,
  documentSymbols,
  formatBasicSource,
  glyphKeyFor,
  hoverAt,
  inkName,
  previewScreen,
  referencesAt,
  renameAt,
  renderCellsSvg,
  renderScreenSvg,
  renumberBasicSource,
  restyleStrings,
  semanticSpans,
  signatureHelpAt,
  stringHoverAt,
  svgDataUri,
  tagCompletionsAt,
  type BasicCell,
  type BasicSourceLocation,
  type BasicSourceRange,
  type BasicStringCell,
} from './index.js';
import {splitPhysicalLines} from './source.js';

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    hoverProvider: true,
    completionProvider: {triggerCharacters: ['{', '$', ' '], resolveProvider: true},
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: {prepareProvider: true},
    documentSymbolProvider: true,
    semanticTokensProvider: {
      legend: {tokenTypes: ['keyword', 'number', 'string', 'comment', 'variable', 'operator'], tokenModifiers: []},
      full: true,
    },
    signatureHelpProvider: {triggerCharacters: ['(', ',']},
    documentFormattingProvider: true,
    codeActionProvider: true,
    executeCommandProvider: {commands: ['clementina.basic.renumber', 'clementina.basic.styleStrings']},
  },
}));

/** Convert a one-based BASIC source span to a zero-based LSP range. */
function toRange(location: BasicSourceLocation): Range {
  return {
    start: {line: location.line - 1, character: location.startCharacter},
    end: {line: location.line - 1, character: location.endCharacter},
  };
}

/** Publish all current diagnostics for an open document. */
function validate(document: TextDocument): void {
  const text = document.getText();
  const lines = splitPhysicalLines(text);
  const diagnostics: Diagnostic[] = analyzeDiagnostics(text).map(item => ({
    severity: item.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    range: toRange({line: item.line, startCharacter: item.startCharacter ?? 0, endCharacter: item.endCharacter ?? lines[item.line - 1]?.length ?? 0}),
    message: item.message,
    source: 'clementina-basic',
    code: item.code,
  }));
  connection.sendDiagnostics({uri: document.uri, diagnostics});
}

documents.onDidOpen(event => validate(event.document));
documents.onDidChangeContent(event => validate(event.document));
documents.onDidClose(event => connection.sendDiagnostics({uri: event.document.uri, diagnostics: []}));

/** Format a byte as `$hh`. */
const hex2 = (code: number): string => `$${code.toString(16).toUpperCase().padStart(2, '0')}`;

/** Wrap text as inline code, even when it is a backtick. */
const inlineCode = (text: string): string => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);

/** Markdown image of cells drawn with the default charset and palette. */
function cellsImage(cells: readonly BasicCell[], cellSize: number, alt: string): string {
  return `![${alt}](${svgDataUri(renderCellsSvg(cells, cellSize))})`;
}

/** How the screen editor types a tile. */
function glyphKeyText(code: number): string {
  const key = glyphKeyFor(code);
  return key ? `glyph mode ${key.mode}, key ${inlineCode(key.key)}` : 'no key types it';
}

/** Name an attribute's color and flags. */
function describeAttribute(attribute: number): string {
  const bank = attribute & BASIC_STYLE_COLOR_MASK;
  return [`color ${bank} (${inkName(bank)})`, ...basicStyleFlags.filter(flag => attribute & flag.bit).map(flag => flag.label)].join(', ');
}

/** Cells of a string as they print; an unstyled one is shown in the startup BASIC pen, $00. */
const printedCells = (cells: readonly BasicStringCell[]): BasicCell[] => cells.map(cell => ({code: cell.code, attribute: cell.attribute ?? 0}));

/** Hover text for a tag or a styled or tagged string, or undefined elsewhere. */
function stringHover(text: string, line: number, character: number): string | undefined {
  const info = stringHoverAt(text, line, character);
  if (!info) return undefined;
  if (info.kind === 'character') {
    const cell = info.string?.cells.find(item => item.startCharacter === info.location.startCharacter);
    const lines = [`**Tile ${hex2(info.code)}** — ${glyphKeyText(info.code)}`, cellsImage([{code: info.code, attribute: cell?.attribute ?? 0}], 48, `tile ${hex2(info.code)}`)];
    const action = consoleControlAction(info.code);
    if (info.string && !info.string.styled && !info.string.data && action) {
      lines.push(`PRINT sends an unstyled string through CHROUT, which does "${action}" instead of drawing this tile. Add a style tag such as \`{c0}\` to draw it.`);
    }
    return lines.join('\n\n');
  }
  if (info.kind === 'style') {
    const lines = [`**${formatBasicStyleTag(info.attribute)}** — ${describeAttribute(info.attribute)}`];
    if (info.styled.length) lines.push(cellsImage(printedCells(info.styled), 24, 'styled characters'));
    return lines.join('\n\n');
  }
  const summary = info.string.styled
    ? '**Styled string**: prints in its stored colors and flips (STYLE can override them)'
    : '**Unstyled string**: prints at the BASIC pen COLOR sets; shown here in the startup pen, color 0';
  return info.string.cells.length ? `${summary}\n\n${cellsImage(printedCells(info.string.cells), 24, 'printed string')}` : summary;
}

connection.onHover((params): Hover | undefined => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return undefined;
  const string = stringHover(document.getText(), params.position.line + 1, params.position.character);
  if (string) return {contents: {kind: MarkupKind.Markdown, value: string}};
  const info = hoverAt(document.getText(), params.position.line + 1, params.position.character);
  if (!info) return undefined;
  const entry = basicKeywordByName.get(info.keyword);
  const lines = [`**${info.keyword}** — ${info.category} token \`${info.token}\``];
  if (entry) lines.push(`\`${entry.syntax}\``, entry.summary);
  return {contents: {kind: MarkupKind.Markdown, value: lines.join('\n\n')}};
});

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const tags = tagCompletionsAt(document.getText(), params.position.line + 1, params.position.character);
  if (tags) {
    return tags.map((item, index): CompletionItem => {
      const range = toRange({line: params.position.line + 1, startCharacter: item.startCharacter, endCharacter: item.endCharacter});
      const base = {label: item.label, detail: item.detail, filterText: item.label, sortText: String(index).padStart(3, '0'), textEdit: TextEdit.replace(range, item.newText)};
      // A color item's documentation is the CSS color an editor shows as a swatch.
      if (item.kind === 'color') return {...base, kind: CompletionItemKind.Color, documentation: cellColors(item.attribute!).ink, labelDetails: {description: inkName(item.attribute!)}};
      if (item.kind === 'flag') return {...base, kind: CompletionItemKind.EnumMember};
      const key = glyphKeyFor(item.code!);
      return {...base, kind: CompletionItemKind.Constant, labelDetails: {description: key ? `mode ${key.mode} ${key.key}` : 'no key'}, data: {code: item.code}};
    });
  }
  // A tag trigger character outside a tag must not open keyword completion.
  if (params.context?.triggerKind === CompletionTriggerKind.TriggerCharacter) return [];
  return completionsAt(document.getText(), params.position.line + 1, params.position.character)
    .map(item => ({label: item.keyword, kind: item.category === 'variable' ? CompletionItemKind.Variable : CompletionItemKind.Keyword, detail: item.category}));
});

// Glyph pictures are rendered only for the item an editor asks about.
connection.onCompletionResolve(item => {
  const code = (item.data as {code?: unknown} | undefined)?.code;
  if (typeof code !== 'number') return item;
  return {...item, documentation: {kind: MarkupKind.Markdown, value: `**Tile ${hex2(code)}** — ${glyphKeyText(code)}\n\n${cellsImage([{code, attribute: 0}], 48, `tile ${hex2(code)}`)}`}};
});

/** Clamp an editor-requested image cell size to a sensible pixel range. */
const cellSizeOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(64, Math.max(4, Math.round(value))) : 16);

// Every tag's range, for an editor that dims them.
connection.onRequest('clementina/basicTags', (params: {textDocument?: {uri?: string}}) => {
  const document = params.textDocument?.uri === undefined ? undefined : documents.get(params.textDocument.uri);
  return document ? analyzeStrings(document.getText()).tags.map(toRange) : [];
});

/** One-based physical lines that ranges touch; a range ending at the start of a later line leaves that line out. */
function touchedLines(ranges: readonly Range[]): number[] {
  const lines = new Set<number>();
  for (const {start, end} of ranges) {
    const last = end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
    for (let line = start.line; line <= last; line++) lines.add(line + 1);
  }
  return [...lines];
}

// What the lines that selections touch print, for an editor's screen preview.
connection.onRequest('clementina/basicScreen', (params: {textDocument?: {uri?: string}; ranges?: unknown}) => {
  const document = params.textDocument?.uri === undefined ? undefined : documents.get(params.textDocument.uri);
  if (!document || !isRangeList(params.ranges)) return {lines: [], placeholders: false, notes: []};
  const preview = previewScreen(document.getText(), touchedLines(params.ranges));
  return {
    lines: preview.lines,
    ...(preview.rows.length ? {image: svgDataUri(renderScreenSvg(preview)), rows: preview.rows.length} : {}),
    placeholders: preview.placeholders.length > 0,
    notes: preview.notes.map(note => `Line ${note.number}: ${note.message}`),
  };
});

// The 16 colors, each as an A in its ink, and the flag words, for a style picker.
connection.onRequest('clementina/basicStyles', (params: {cellSize?: number} | undefined) => {
  const cellSize = cellSizeOf(params?.cellSize);
  const colors = [];
  for (let bank = 0; bank <= BASIC_STYLE_COLOR_MASK; bank++) {
    colors.push({bank, word: `c${bank}`, name: inkName(bank), icon: svgDataUri(renderCellsSvg([{code: 0x41, attribute: bank}], cellSize))});
  }
  return {colors, flags: basicStyleFlags.map(flag => ({word: flag.word, label: flag.label, bit: flag.bit}))};
});

// Every storable tile, for a glyph picker.
connection.onRequest('clementina/basicGlyphs', (params: {cellSize?: number} | undefined) => {
  const cellSize = cellSizeOf(params?.cellSize);
  const glyphs = [];
  for (let code = 1; code < 0x100; code++) {
    if (code === 0x22) continue;
    glyphs.push({code, label: hex2(code), description: glyphKeyText(code).replace(/`/gu, ''), icon: svgDataUri(renderCellsSvg([{code, attribute: 0}], cellSize))});
  }
  return glyphs;
});

connection.onDefinition(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return undefined;
  const definition = definitionAt(document.getText(), params.position.line + 1, params.position.character);
  if (!definition) return undefined;
  return Location.create(document.uri, toRange(definition));
});

connection.onReferences(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return referencesAt(document.getText(), params.position.line + 1, params.position.character, params.context.includeDeclaration)
    .map(location => Location.create(document.uri, toRange(location)));
});

connection.onPrepareRename(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const locations = referencesAt(document.getText(), params.position.line + 1, params.position.character, true);
  const location = locations.find(item => item.line === params.position.line + 1
    && params.position.character >= item.startCharacter && params.position.character < item.endCharacter);
  if (!location) return null;
  const range = toRange(location);
  return {range, placeholder: document.getText(range)};
});

connection.onRenameRequest(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  try {
    const edits = renameAt(document.getText(), params.position.line + 1, params.position.character, params.newName)
      .map(edit => TextEdit.replace(toRange(edit), edit.newText));
    return {changes: {[document.uri]: edits}};
  } catch (error) {
    throw new ResponseError(ErrorCodes.InvalidParams, errorMessage(error));
  }
});

connection.onDocumentSymbol(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return documentSymbols(document.getText()).map(symbol => {
    const range = toRange(symbol);
    return {name: symbol.name, kind: symbol.kind === 'line' ? SymbolKind.Event : SymbolKind.Variable, range, selectionRange: range};
  });
});

connection.languages.semanticTokens.on(params => {
  const document = documents.get(params.textDocument.uri);
  const builder = new SemanticTokensBuilder();
  if (!document) return builder.build();
  const tokenTypes = new Map([['keyword', 0], ['number', 1], ['string', 2], ['comment', 3], ['variable', 4], ['operator', 5]]);
  for (const span of semanticSpans(document.getText())) {
    builder.push(span.line - 1, span.startCharacter, span.endCharacter - span.startCharacter, tokenTypes.get(span.type)!, 0);
  }
  return builder.build();
});

connection.onSignatureHelp((params): SignatureHelp | undefined => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return undefined;
  const info = signatureHelpAt(document.getText(), params.position.line + 1, params.position.character);
  if (!info) return undefined;
  return {
    signatures: [{label: info.label, parameters: parameterRanges(info.label, info.parameters)}],
    activeSignature: 0,
    activeParameter: info.activeParameter,
  };
});

/**
 * Point each parameter at its name in the label, searching left to right, so a
 * client highlights `x` in `SPRITE index,tile,x,...` rather than the x in `index`.
 * Names are lowercase-first, so `name` still matches inside `FNname`.
 */
function parameterRanges(label: string, parameters: readonly string[]): ParameterInformation[] {
  let from = 0;
  return parameters.map(parameter => {
    const name = parameter.replace(/(?:\.\.\.)?\??$/u, '');
    const escaped = name.replace(/[.*+?^$()[\]{}|\\/]/gu, '\\$&');
    const match = new RegExp(`(?<![a-z0-9])${escaped}(?![A-Za-z0-9])`, 'u').exec(label.slice(from));
    if (!match) return {label: parameter};
    const start = from + match.index;
    from = start + name.length;
    return {label: [start, from]};
  });
}

/** Cover the entire current text, including its final line ending. */
function wholeDocumentRange(document: TextDocument): Range {
  return {start: {line: 0, character: 0}, end: document.positionAt(document.getText().length)};
}

connection.onDocumentFormatting(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  try {
    return [TextEdit.replace(wholeDocumentRange(document), formatBasicSource(document.getText()))];
  } catch {
    return [];
  }
});

connection.onCodeAction((params): CodeAction[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return [{
    title: 'Renumber BASIC program',
    kind: CodeActionKind.Source,
    command: {title: 'Renumber BASIC program', command: 'clementina.basic.renumber', arguments: [document.uri, 10, 10]},
  }];
});

/** Check that a command argument is a list of LSP ranges. */
function isRangeList(value: unknown): value is Range[] {
  const position = (item: unknown): boolean => typeof item === 'object' && item !== null
    && Number.isInteger((item as {line?: unknown}).line) && Number.isInteger((item as {character?: unknown}).character);
  return Array.isArray(value) && value.every(range => typeof range === 'object' && range !== null && position(range.start) && position(range.end));
}

connection.onExecuteCommand(async params => {
  if (params.command === 'clementina.basic.styleStrings') return styleStrings(params.arguments ?? []);
  if (params.command !== 'clementina.basic.renumber') return undefined;
  const [uri, start = 10, step = 10] = params.arguments ?? [];
  if (typeof uri !== 'string' || typeof start !== 'number' || typeof step !== 'number') return false;
  const document = documents.get(uri);
  if (!document) return false;
  try {
    const newText = renumberBasicSource(document.getText(), {start, step});
    const response = await connection.workspace.applyEdit({changes: {[uri]: [TextEdit.replace(wholeDocumentRange(document), newText)]}});
    return response.applied;
  } catch (error) {
    void connection.window.showErrorMessage(`Cannot renumber BASIC program: ${errorMessage(error)}`);
    return false;
  }
});

/** Apply one attribute to the selected string characters, or remove styles with a null attribute. */
async function styleStrings(args: unknown[]): Promise<boolean> {
  const [uri, ranges, attribute] = args;
  if (typeof uri !== 'string' || !isRangeList(ranges) || !(attribute === null || typeof attribute === 'number')) return false;
  const document = documents.get(uri);
  if (!document) return false;
  const selections: BasicSourceRange[] = ranges.map(range => ({
    start: {line: range.start.line + 1, character: range.start.character},
    end: {line: range.end.line + 1, character: range.end.character},
  }));
  try {
    const edits = restyleStrings(document.getText(), selections, attribute);
    if (edits.length === 0) {
      void connection.window.showInformationMessage('Nothing to restyle: select characters inside a quoted string.');
      return false;
    }
    const response = await connection.workspace.applyEdit({changes: {[uri]: edits.map(edit => TextEdit.replace(toRange(edit), edit.newText))}});
    return response.applied;
  } catch (error) {
    void connection.window.showErrorMessage(`Cannot style BASIC strings: ${errorMessage(error)}`);
    return false;
  }
}

documents.listen(connection);
connection.listen();
