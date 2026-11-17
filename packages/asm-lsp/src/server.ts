/**
 * The Clementina assembly language server (stdio). It indexes the workspace's
 * `.s` and `.inc` files and the Clementina library, answers hover, completion,
 * navigation, rename, outline and folding requests, and reports ca65's own
 * errors as the code is typed.
 *
 * Initialization options (all optional):
 * - `libraryDirectory`: where to write the library's sources so the editor can open them.
 * - `ca65Path`: the ca65 executable; by default the installed tools, then PATH.
 * - `diagnostics`: `onType` (default), `onSave` or `off`.
 * The `clementina.assembly` settings section can change `ca65Path` and `diagnostics` later.
 */
import {mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join, normalize, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  createConnection,
  CompletionItemKind,
  DiagnosticSeverity,
  DocumentHighlightKind,
  FoldingRangeKind,
  MarkupKind,
  ProposedFeatures,
  ResponseError,
  ErrorCodes,
  SymbolKind,
  TextDocuments,
  TextDocumentSyncKind,
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type Range,
  type WorkspaceEdit,
} from 'vscode-languageserver/node.js';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {libraryFiles} from '@clementina/lib';
import {assembleForDiagnostics, findCa65, type Ca65Message} from './ca65.js';
import {completionsAt, documentOutline, explainCa65, hoverAt, signatureHelpAt, type CompletionKind, type OutlineSymbol} from './features.js';
import {qualifiedName, type AsmSymbolKind, type Span} from './parser.js';
import {findProjectRoot, readAsmProject, readLabels, type AsmProject} from './project.js';
import {AsmWorkspace, type Occurrence} from './workspace.js';

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);

interface Settings {
  ca65Path?: string;
  diagnostics: 'onType' | 'onSave' | 'off';
}

let settings: Settings = {diagnostics: 'onType'};
let libraryDirectory = join(tmpdir(), 'clementina-asm-lsp');
let roots: string[] = [];
const projects = new Map<string, AsmProject>();
const workspace = new AsmWorkspace(path => includeDirectories(path));
const SOURCE_EXTENSIONS = new Set(['.s', '.inc', '.asm']);

const toPath = (uri: string) => normalize(fileURLToPath(uri));
/** The URI the client uses for a path when the file is open, else a file URI. */
const toUri = (path: string) => documents.all().find(document => document.uri.startsWith('file:') && toPath(document.uri) === normalize(path))?.uri ?? pathToFileURL(path).href;
const toRange = (span: Span): Range => ({start: {line: span.line, character: span.start}, end: {line: span.line, character: span.end}});
const location = (occurrence: Occurrence): Location => ({uri: toUri(occurrence.path), range: toRange(occurrence.span)});

function projectFor(path: string): AsmProject | undefined {
  const root = findProjectRoot(path);
  if (!root) return undefined;
  let project = projects.get(root);
  if (!project) {
    project = readAsmProject(root);
    projects.set(root, project);
  }
  return project;
}

function includeDirectories(path: string): string[] {
  return [...(projectFor(path)?.includeDirectories ?? []), libraryDirectory];
}

/** Write the library's sources where the editor can open them, and index them. */
function installLibrary(): void {
  try {
    mkdirSync(libraryDirectory, {recursive: true});
    for (const [name, text] of Object.entries(libraryFiles)) {
      const path = join(libraryDirectory, name);
      let current: string | undefined;
      try { current = readFileSync(path, 'utf8'); } catch { /* new */ }
      if (current !== text) writeFileSync(path, text);
    }
  } catch (error) {
    connection.console.warn(`Could not write the Clementina library to ${libraryDirectory}: ${String(error)}`);
  }
  for (const [name, text] of Object.entries(libraryFiles)) workspace.set(join(libraryDirectory, name), text, true);
}

/** True for copies the server should not index twice: its own library folder, and the library and machine includes a build copies. */
function isBuildCopy(path: string): boolean {
  if (normalize(path).startsWith(normalize(libraryDirectory) + sep)) return true;
  const project = projectFor(path);
  if (!project) return false;
  return [join(project.outputDirectory, 'lib'), join(project.outputDirectory, 'include')].some(dir => path.startsWith(dir + sep));
}

function scan(directory: string, depth = 0): void {
  if (depth > 12) return;
  let entries: string[];
  try { entries = readdirSync(directory); } catch { return; }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const path = join(directory, name);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isDirectory()) scan(path, depth + 1);
    else if (SOURCE_EXTENSIONS.has(extname(name).toLowerCase()) && stat.size < 2_000_000 && !isBuildCopy(path)) loadFromDisk(path);
  }
}

function loadFromDisk(path: string): void {
  if (documents.all().some(document => toPath(document.uri) === normalize(path))) return;
  try { workspace.set(path, readFileSync(path, 'utf8')); } catch { workspace.delete(path); }
}

function loadLabels(): void {
  const addresses = new Map<string, number>();
  for (const project of projects.values()) {
    if (!project.labelFile) continue;
    for (const [name, value] of readLabels(project.labelFile)) if (!addresses.has(name)) addresses.set(name, value);
  }
  workspace.addresses = addresses;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const options = (params.initializationOptions ?? {}) as Partial<Settings> & {libraryDirectory?: string};
  if (options.libraryDirectory) libraryDirectory = options.libraryDirectory;
  settings = {...settings, ...(options.ca65Path ? {ca65Path: options.ca65Path} : {}), ...(options.diagnostics ? {diagnostics: options.diagnostics} : {})};
  roots = (params.workspaceFolders ?? []).map(folder => toPath(folder.uri));
  if (!roots.length && params.rootUri) roots = [toPath(params.rootUri)];
  return {
    capabilities: {
      textDocumentSync: {openClose: true, change: TextDocumentSyncKind.Full, save: true},
      hoverProvider: true,
      completionProvider: {triggerCharacters: ['.', '@']},
      signatureHelpProvider: {triggerCharacters: [' ', ',']},
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      renameProvider: {prepareProvider: true},
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      foldingRangeProvider: true,
      documentLinkProvider: {resolveProvider: false},
    },
  };
});

connection.onInitialized(() => {
  installLibrary();
  for (const root of roots) scan(root);
  loadLabels();
});

connection.onDidChangeConfiguration(change => {
  const section = (change.settings as {clementina?: {assembly?: Partial<Settings>}} | undefined)?.clementina?.assembly;
  if (!section) return;
  settings = {ca65Path: section.ca65Path || undefined, diagnostics: section.diagnostics ?? 'onType'};
  missingReported = false;
  for (const document of documents.all()) scheduleDiagnostics(document);
});

connection.onDidChangeWatchedFiles(change => {
  for (const event of change.changes) {
    const path = toPath(event.uri);
    if (path.endsWith('clementina.yaml')) {
      projects.clear();
      continue;
    }
    if (path.endsWith('.lbl')) continue;
    if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) || isBuildCopy(path)) continue;
    if (event.type === 3) workspace.delete(path);
    else loadFromDisk(path);
  }
  loadLabels();
});

// --- Diagnostics -----------------------------------------------------------

/** ca65 messages by the open source that produced them, then by the file they are about. */
const reported = new Map<string, Map<string, Diagnostic[]>>();
const published = new Set<string>();
const timers = new Map<string, NodeJS.Timeout>();
let missingReported = false;

function publishAll(): void {
  const byPath = new Map<string, Diagnostic[]>();
  for (const files of reported.values()) {
    for (const [path, diagnostics] of files) byPath.set(path, [...(byPath.get(path) ?? []), ...diagnostics]);
  }
  for (const path of published) if (!byPath.has(path)) connection.sendDiagnostics({uri: toUri(path), diagnostics: []});
  published.clear();
  for (const [path, diagnostics] of byPath) {
    // The same include can be reached from two open sources.
    const unique = [...new Map(diagnostics.map(item => [`${item.range.start.line}:${item.message}`, item])).values()];
    connection.sendDiagnostics({uri: toUri(path), diagnostics: unique});
    published.add(path);
  }
}

function toDiagnostics(messages: Ca65Message[], owner: string): Map<string, Diagnostic[]> {
  const out = new Map<string, Diagnostic[]>();
  for (const message of explainCa65(workspace, messages)) {
    const lines = workspace.get(message.path)?.parsed.lines;
    const text = lines?.[message.line] ?? '';
    const indent = text.length - text.trimStart().length;
    const diagnostic: Diagnostic = {
      severity: message.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      range: {start: {line: message.line, character: indent}, end: {line: message.line, character: Math.max(indent, text.trimEnd().length)}},
      message: message.message,
      source: 'ca65',
      ...(message.notes.length ? {relatedInformation: message.notes.map(note => ({location: {uri: toUri(note.path), range: {start: {line: note.line, character: 0}, end: {line: note.line, character: 0}}}, message: note.message}))} : {}),
    };
    // A message about a file the editor does not know is shown on the source being assembled.
    const path = workspace.get(message.path) || message.path === owner ? message.path : owner;
    if (path !== message.path) diagnostic.message = `${relative(projectFor(owner)?.root ?? '', message.path)}:${message.line + 1}: ${message.message}`;
    if (path !== message.path) diagnostic.range = {start: {line: 0, character: 0}, end: {line: 0, character: 0}};
    out.set(path, [...(out.get(path) ?? []), diagnostic]);
  }
  return out;
}

async function runDiagnostics(document: TextDocument): Promise<void> {
  const path = toPath(document.uri);
  if (settings.diagnostics === 'off' || extname(path).toLowerCase() === '.inc') {
    reported.delete(path);
    publishAll();
    return;
  }
  const ca65 = findCa65(settings.ca65Path);
  if (!ca65) {
    if (!missingReported) {
      missingReported = true;
      void connection.window.showWarningMessage('Clementina: ca65 was not found, so assembly errors are not checked as you type. `clementina install` installs it, or set "clementina.assembly.ca65Path".');
    }
    return;
  }
  const project = projectFor(path);
  const version = document.version;
  try {
    const messages = await assembleForDiagnostics(path, document.getText(), {
      ca65, cwd: project?.root ?? join(path, '..'), includeDirectories: includeDirectories(path), defines: project?.defines ?? {},
    });
    if (documents.get(document.uri)?.version !== version) return;
    reported.set(path, toDiagnostics(messages, path));
    publishAll();
  } catch (error) {
    if (!missingReported) {
      missingReported = true;
      void connection.window.showWarningMessage(`Clementina: could not run ca65 (${ca65}): ${String(error)}`);
    }
  }
}

function scheduleDiagnostics(document: TextDocument, delay = 300): void {
  const key = document.uri;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void runDiagnostics(document);
  }, delay));
}

documents.onDidOpen(event => {
  workspace.set(toPath(event.document.uri), event.document.getText());
  scheduleDiagnostics(event.document, 0);
});
documents.onDidChangeContent(event => {
  workspace.set(toPath(event.document.uri), event.document.getText());
  if (settings.diagnostics === 'onType') scheduleDiagnostics(event.document);
});
documents.onDidSave(event => {
  // Sources that include the saved file see its new text on disk.
  for (const document of documents.all()) scheduleDiagnostics(document, document === event.document ? 0 : 100);
});
documents.onDidClose(event => {
  const path = toPath(event.document.uri);
  reported.delete(path);
  publishAll();
  loadFromDisk(path);
});

// --- Language features -----------------------------------------------------

const pathOf = (uri: string) => toPath(uri);

connection.onHover(params => {
  const hover = hoverAt(workspace, pathOf(params.textDocument.uri), params.position.line, params.position.character);
  return hover && {contents: {kind: MarkupKind.Markdown, value: hover.markdown}, range: toRange(hover.span)};
});

const completionKinds: Record<CompletionKind, CompletionItemKind> = {
  instruction: CompletionItemKind.Keyword, directive: CompletionItemKind.Keyword, function: CompletionItemKind.Function,
  macro: CompletionItemKind.Snippet, define: CompletionItemKind.Snippet, label: CompletionItemKind.Reference, local: CompletionItemKind.Reference,
  proc: CompletionItemKind.Function, constant: CompletionItemKind.Constant, variable: CompletionItemKind.Variable, scope: CompletionItemKind.Module,
  struct: CompletionItemKind.Struct, union: CompletionItemKind.Struct, enum: CompletionItemKind.Enum, member: CompletionItemKind.Field, import: CompletionItemKind.Reference,
};

connection.onCompletion((params): CompletionItem[] => {
  const items = completionsAt(workspace, pathOf(params.textDocument.uri), params.position.line, params.position.character);
  return items.map((item, index) => ({
    label: item.label, kind: completionKinds[item.kind], detail: item.detail,
    ...(item.documentation ? {documentation: {kind: MarkupKind.Markdown, value: item.documentation}} : {}),
    // Instructions first at the word position; nearer names first in an operand.
    sortText: String(index).padStart(5, '0'),
  }));
});

connection.onSignatureHelp(params => {
  const help = signatureHelpAt(workspace, pathOf(params.textDocument.uri), params.position.line, params.position.character);
  if (!help) return null;
  return {
    signatures: [{
      label: help.label, parameters: help.parameters.map(label => ({label})),
      ...(help.documentation ? {documentation: {kind: MarkupKind.Markdown, value: help.documentation}} : {}),
    }],
    activeSignature: 0,
    activeParameter: Math.min(help.activeParameter, Math.max(0, help.parameters.length - 1)),
  };
});

connection.onDefinition(params => {
  const path = pathOf(params.textDocument.uri);
  const {line, character} = params.position;
  const unnamed = workspace.unnamedTargetAt(path, line, character);
  if (unnamed) return location(unnamed);
  const include = workspace.get(path)?.parsed.includes.find(item => item.span.line === line && character >= item.span.start && character <= item.span.end);
  if (include) {
    const target = workspace.resolveInclude(path, include.path);
    return target ? {uri: toUri(target), range: {start: {line: 0, character: 0}, end: {line: 0, character: 0}}} : null;
  }
  const at = workspace.targetAt(path, line, character);
  return at ? location({path: at.target.path, span: at.target.symbol.span}) : null;
});

connection.onReferences(params => workspace.occurrences(pathOf(params.textDocument.uri), params.position.line, params.position.character, params.context.includeDeclaration).map(location));

connection.onDocumentHighlight(params => {
  const path = pathOf(params.textDocument.uri);
  return workspace.occurrences(path, params.position.line, params.position.character)
    .filter(item => normalize(item.path) === normalize(path))
    .map(item => ({range: toRange(item.span), kind: DocumentHighlightKind.Text}));
});

/** The definition to rename at a position, refusing library symbols. */
function renameTarget(uri: string, line: number, character: number) {
  const path = pathOf(uri);
  const at = workspace.targetAt(path, line, character);
  if (!at) throw new ResponseError(ErrorCodes.InvalidRequest, 'No assembly symbol here to rename');
  if (workspace.get(at.target.path)?.library) throw new ResponseError(ErrorCodes.InvalidRequest, `${at.target.symbol.name} belongs to the Clementina library and cannot be renamed`);
  return {path, at};
}

connection.onPrepareRename(params => {
  const {at} = renameTarget(params.textDocument.uri, params.position.line, params.position.character);
  const text = workspace.get(pathOf(params.textDocument.uri))!.parsed.lines[at.span.line]!.slice(at.span.start, at.span.end);
  // Rename only the last part of `scope::name`.
  const start = at.span.end - (text.length - (text.lastIndexOf(':') + 1));
  return {start: {line: at.span.line, character: start}, end: {line: at.span.line, character: at.span.end}};
});

connection.onRenameRequest((params): WorkspaceEdit => {
  const {path, at} = renameTarget(params.textDocument.uri, params.position.line, params.position.character);
  const local = at.target.symbol.name.startsWith('@');
  const valid = local ? /^@[A-Za-z0-9_]+$/u : /^[A-Za-z_][A-Za-z0-9_]*$/u;
  if (!valid.test(params.newName)) throw new ResponseError(ErrorCodes.InvalidParams, local ? 'A cheap local label is @ followed by letters, digits or _' : 'A ca65 symbol starts with a letter or _ and has only letters, digits and _');
  const changes: Record<string, Array<{range: Range; newText: string}>> = {};
  for (const occurrence of workspace.occurrences(path, params.position.line, params.position.character)) {
    const text = workspace.get(occurrence.path)!.parsed.lines[occurrence.span.line]!.slice(occurrence.span.start, occurrence.span.end);
    const start = occurrence.span.start + text.lastIndexOf(':') + 1;
    (changes[toUri(occurrence.path)] ??= []).push({range: {start: {line: occurrence.span.line, character: start}, end: {line: occurrence.span.line, character: occurrence.span.end}}, newText: params.newName});
  }
  return {changes};
});

const symbolKinds: Record<AsmSymbolKind, SymbolKind> = {
  label: SymbolKind.Key, local: SymbolKind.Key, constant: SymbolKind.Constant, variable: SymbolKind.Variable, macro: SymbolKind.Function,
  define: SymbolKind.Function, proc: SymbolKind.Method, scope: SymbolKind.Namespace, struct: SymbolKind.Struct, union: SymbolKind.Struct,
  enum: SymbolKind.Enum, member: SymbolKind.Field, import: SymbolKind.Interface,
};

function toDocumentSymbol(node: OutlineSymbol): DocumentSymbol {
  const lineLength = 1000;
  return {
    name: node.name, kind: symbolKinds[node.kind], ...(node.detail ? {detail: node.detail} : {}),
    range: {start: {line: node.span.line, character: 0}, end: {line: node.endLine, character: lineLength}},
    selectionRange: toRange(node.span),
    children: node.children.map(toDocumentSymbol),
  };
}

connection.onDocumentSymbol(params => documentOutline(workspace, pathOf(params.textDocument.uri)).map(toDocumentSymbol));

connection.onWorkspaceSymbol(params => {
  const query = params.query.toLowerCase();
  return workspace.allSymbols()
    .filter(target => !workspace.get(target.path)?.library && target.symbol.kind !== 'import' && target.symbol.kind !== 'local' && qualifiedName(target.symbol).toLowerCase().includes(query))
    .slice(0, 500)
    .map(target => ({name: qualifiedName(target.symbol), kind: symbolKinds[target.symbol.kind], location: location({path: target.path, span: target.symbol.span})}));
});

connection.onFoldingRanges(params => (workspace.get(pathOf(params.textDocument.uri))?.parsed.folds ?? [])
  .filter(fold => fold.end > fold.start)
  .map(fold => ({startLine: fold.start, endLine: fold.end, ...(fold.kind ? {kind: FoldingRangeKind.Comment} : {})})));

connection.onDocumentLinks(params => {
  const path = pathOf(params.textDocument.uri);
  return (workspace.get(path)?.parsed.includes ?? []).flatMap(include => {
    const target = workspace.resolveInclude(path, include.path) ?? (include.binary ? join(path, '..', include.path) : undefined);
    return target ? [{range: toRange(include.span), target: toUri(target)}] : [];
  });
});

documents.listen(connection);
connection.listen();
