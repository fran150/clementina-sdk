/**
 * The Clementina assembly language server (stdio). It indexes the workspace's
 * `.s` and `.inc` files and the Clementina library, answers hover, completion,
 * navigation, rename, outline and folding requests, and reports ca65's own
 * errors as the code is typed. It also serves ld65 linker configurations
 * (`link.cfg`, language id `clementina-ld65`): their checks, against ld65 and
 * Clementina's memory map, hover, completion, definitions and outline.
 *
 * Initialization options (all optional):
 * - `libraryDirectory`: where to write the library's sources so the editor can open them.
 * - `ca65Path`: the ca65 executable; by default the installed tools, then PATH.
 * - `ld65Path`: the ld65 executable, found the same way.
 * - `diagnostics`: `onType` (default), `onSave` or `off`: when ca65 and ld65 run.
 * The `clementina.assembly` settings section can change these later.
 */
import {mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join, normalize, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  createConnection,
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
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
import {configCompletions, configDefinition, configDiagnostics, configHover, configOutline, type ConfigCompletionKind, type ConfigDiagnostic, type ConfigOutlineSymbol, type ConfigProject} from './ld65-features.js';
import {parseConfig, type ParsedConfig} from './ld65-config.js';
import {checkWithLd65, findLd65} from './ld65.js';
import {bankedSegments, workspaceBankWarnings} from './bank-check.js';
import {qualifiedName, type AsmSymbolKind, type Span} from './parser.js';
import {findProjectRoot, readAsmProject, readLabels, type AsmProject} from './project.js';
import {AsmWorkspace, type Occurrence} from './workspace.js';

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);

interface Settings {
  ca65Path?: string;
  ld65Path?: string;
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
  settings = {
    ...settings, ...(options.ca65Path ? {ca65Path: options.ca65Path} : {}), ...(options.ld65Path ? {ld65Path: options.ld65Path} : {}),
    ...(options.diagnostics ? {diagnostics: options.diagnostics} : {}),
  };
  roots = (params.workspaceFolders ?? []).map(folder => toPath(folder.uri));
  if (!roots.length && params.rootUri) roots = [toPath(params.rootUri)];
  return {
    capabilities: {
      textDocumentSync: {openClose: true, change: TextDocumentSyncKind.Full, save: true},
      hoverProvider: true,
      // `=`, `,`, `:` and space are for linker configurations; assembly ignores them.
      completionProvider: {triggerCharacters: ['.', '@', '=', ',', ':', ' ']},
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
  settings = {ca65Path: section.ca65Path || undefined, ld65Path: section.ld65Path || undefined, diagnostics: section.diagnostics ?? 'onType'};
  missingReported = false;
  ld65MissingReported = false;
  for (const document of documents.all()) scheduleDiagnostics(document);
});

connection.onDidChangeWatchedFiles(change => {
  for (const event of change.changes) {
    const path = toPath(event.uri);
    if (path.endsWith('clementina.yaml')) {
      projects.clear();
      scheduleConfigChecks();
      continue;
    }
    if (path.endsWith('.lbl')) continue;
    if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) || isBuildCopy(path)) continue;
    if (event.type === 3) workspace.delete(path);
    else loadFromDisk(path);
    scheduleConfigChecks();
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

/** The linker configuration of a source file's project, parsed: the open document's text, else the file's. */
function projectConfig(project: AsmProject | undefined): ParsedConfig | undefined {
  if (!project?.linkerConfig) return undefined;
  const open = documents.all().find(document => toPath(document.uri) === normalize(project.linkerConfig!));
  if (open) return parsedConfig(open);
  try { return parseConfig(readFileSync(project.linkerConfig, 'utf8')); } catch { return undefined; }
}

/** Warnings for stores to VIA Port A in code linked at $8000-$BFFF. */
function bankDiagnostics(path: string): Diagnostic[] {
  const project = projectFor(path);
  const config = projectConfig(project);
  if (!project || !config) return [];
  return workspaceBankWarnings(workspace, path, bankedSegments(config, project.banks))
    .map(warning => ({severity: DiagnosticSeverity.Warning, range: toRange(warning.span), message: warning.message, source: 'clementina'}));
}

async function runDiagnostics(document: TextDocument): Promise<void> {
  if (isConfig(document)) return runConfigDiagnostics(document);
  const path = toPath(document.uri);
  if (settings.diagnostics === 'off' || extname(path).toLowerCase() === '.inc') {
    reported.delete(path);
    publishAll();
    return;
  }
  const banks = bankDiagnostics(path);
  const withBanks = (out: Map<string, Diagnostic[]>) => {
    if (banks.length) out.set(path, [...(out.get(path) ?? []), ...banks]);
    return out;
  };
  const ca65 = findCa65(settings.ca65Path);
  if (!ca65) {
    reported.set(path, withBanks(new Map()));
    publishAll();
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
    reported.set(path, withBanks(toDiagnostics(messages, path)));
    publishAll();
  } catch (error) {
    if (!missingReported) {
      missingReported = true;
      void connection.window.showWarningMessage(`Clementina: could not run ca65 (${ca65}): ${String(error)}`);
    }
  }
}

function scheduleDiagnostics(document: TextDocument, delay = 300, withLd65 = true): void {
  const key = document.uri;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void (isConfig(document) ? runConfigDiagnostics(document, withLd65) : runDiagnostics(document));
  }, delay));
}

documents.onDidOpen(event => {
  if (isConfig(event.document)) { scheduleDiagnostics(event.document, 0); return; }
  workspace.set(toPath(event.document.uri), event.document.getText());
  scheduleDiagnostics(event.document, 0);
  scheduleConfigChecks();
});
documents.onDidChangeContent(event => {
  if (isConfig(event.document)) {
    // The quick checks always run as you type; ld65 itself only with onType.
    scheduleDiagnostics(event.document, 300, settings.diagnostics === 'onType');
    // Which segments are banked comes from here: check the open sources again.
    for (const document of documents.all()) if (!isConfig(document)) scheduleDiagnostics(document, 500);
    return;
  }
  workspace.set(toPath(event.document.uri), event.document.getText());
  if (settings.diagnostics === 'onType') scheduleDiagnostics(event.document);
  scheduleConfigChecks();
});
documents.onDidSave(event => {
  // Sources that include the saved file see its new text on disk.
  for (const document of documents.all()) scheduleDiagnostics(document, document === event.document ? 0 : 100);
});
documents.onDidClose(event => {
  const path = toPath(event.document.uri);
  if (isConfig(event.document)) {
    parsedConfigs.delete(event.document.uri);
    connection.sendDiagnostics({uri: event.document.uri, diagnostics: []});
    return;
  }
  reported.delete(path);
  publishAll();
  loadFromDisk(path);
});

// --- Linker configurations -------------------------------------------------

const parsedConfigs = new Map<string, {version: number; config: ParsedConfig}>();
let ld65MissingReported = false;
let configTimer: NodeJS.Timeout | undefined;

/** True for an ld65 configuration: the client's `clementina-ld65` language, or a `.cfg` file. */
function isConfig(document: TextDocument | undefined): boolean {
  if (!document) return false;
  return document.languageId === 'clementina-ld65' || document.languageId === 'ld65' || extname(toPath(document.uri)).toLowerCase() === '.cfg';
}

const configDocument = (uri: string) => {
  const document = documents.get(uri);
  return document && isConfig(document) ? document : undefined;
};

function parsedConfig(document: TextDocument): ParsedConfig {
  const cached = parsedConfigs.get(document.uri);
  if (cached?.version === document.version) return cached.config;
  const config = parseConfig(document.getText());
  parsedConfigs.set(document.uri, {version: document.version, config});
  return config;
}

/** What the configuration's project says: whether it returns to BASIC, memoryTop, loadAddress, the segments its sources use. */
function configProject(path: string): ConfigProject | undefined {
  const project = projectFor(path);
  if (!project) return undefined;
  const segments: ConfigProject['segments'] = [];
  for (const file of workspace.files.values()) {
    if (file.library || !file.path.startsWith(project.root + sep) || file.path.startsWith(project.outputDirectory + sep)) continue;
    for (const segment of file.parsed.segments) segments.push({name: segment.name, file: relative(project.root, file.path), line: segment.line});
  }
  segments.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return {
    returnsToBasic: project.returnsToBasic, linked: project.linkerConfig !== undefined && normalize(project.linkerConfig) === normalize(path), segments,
    ...(project.memoryTop !== undefined ? {memoryTop: project.memoryTop} : {}),
    ...(project.loadAddress !== undefined ? {loadAddress: project.loadAddress} : {}),
  };
}

const severities = {error: DiagnosticSeverity.Error, warning: DiagnosticSeverity.Warning, information: DiagnosticSeverity.Information};
const ld65Results = new Map<string, {version: number; diagnostics: Diagnostic[]}>();

function toConfigDiagnostic(item: ConfigDiagnostic): Diagnostic {
  return {severity: severities[item.severity], range: toRange(item.span), message: item.message, source: 'clementina'};
}

/** The quick checks, then ld65's own when they find no error. */
async function runConfigDiagnostics(document: TextDocument, withLd65 = true): Promise<void> {
  const path = toPath(document.uri);
  const config = parsedConfig(document);
  const own = configDiagnostics(config, configProject(path)).map(toConfigDiagnostic);
  const version = document.version;
  const publish = (extra: Diagnostic[]) => connection.sendDiagnostics({uri: document.uri, diagnostics: [...own, ...extra]});
  const previous = ld65Results.get(document.uri);
  publish(previous?.version === version ? previous.diagnostics : []);
  if (!withLd65 || settings.diagnostics === 'off' || own.some(item => item.severity === DiagnosticSeverity.Error)) return;
  if (previous?.version === version) return;
  const ld65 = findLd65(settings.ld65Path);
  if (!ld65) {
    if (!ld65MissingReported) {
      ld65MissingReported = true;
      void connection.window.showWarningMessage('Clementina: ld65 was not found, so linker configurations get only the editor\'s own checks. `clementina install` installs it, or set "clementina.assembly.ld65Path".');
    }
    return;
  }
  try {
    const messages = await checkWithLd65(path, document.getText(), ld65);
    if (documents.get(document.uri)?.version !== version) return;
    const diagnostics = messages.map((message): Diagnostic => {
      const line = message.line ?? 0;
      const text = config.lines[line] ?? '';
      const indent = text.length - text.trimStart().length;
      return {
        severity: message.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        range: {start: {line, character: indent}, end: {line, character: Math.max(indent, text.replace(/#.*$/u, '').trimEnd().length)}},
        message: message.message, source: 'ld65',
      };
    });
    ld65Results.set(document.uri, {version, diagnostics});
    publish(diagnostics);
  } catch (error) {
    if (!ld65MissingReported) {
      ld65MissingReported = true;
      void connection.window.showWarningMessage(`Clementina: could not run ld65 (${ld65}): ${String(error)}`);
    }
  }
}

/** Sources or the manifest changed: check the open configurations again (without rerunning ld65). */
function scheduleConfigChecks(): void {
  clearTimeout(configTimer);
  configTimer = setTimeout(() => {
    for (const document of documents.all()) if (isConfig(document)) void runConfigDiagnostics(document, false);
  }, 500);
}

// --- Language features -----------------------------------------------------

const pathOf = (uri: string) => toPath(uri);

connection.onHover(params => {
  const config = configDocument(params.textDocument.uri);
  if (config) {
    const found = configHover(parsedConfig(config), params.position.line, params.position.character, configProject(toPath(config.uri)));
    return found ? {contents: {kind: MarkupKind.Markdown, value: found.markdown}, range: toRange(found.span)} : null;
  }
  const hover = hoverAt(workspace, pathOf(params.textDocument.uri), params.position.line, params.position.character);
  return hover && {contents: {kind: MarkupKind.Markdown, value: hover.markdown}, range: toRange(hover.span)};
});

const completionKinds: Record<CompletionKind, CompletionItemKind> = {
  instruction: CompletionItemKind.Keyword, directive: CompletionItemKind.Keyword, function: CompletionItemKind.Function,
  macro: CompletionItemKind.Snippet, define: CompletionItemKind.Snippet, label: CompletionItemKind.Reference, local: CompletionItemKind.Reference,
  proc: CompletionItemKind.Function, constant: CompletionItemKind.Constant, variable: CompletionItemKind.Variable, scope: CompletionItemKind.Module,
  struct: CompletionItemKind.Struct, union: CompletionItemKind.Struct, enum: CompletionItemKind.Enum, member: CompletionItemKind.Field, import: CompletionItemKind.Reference,
};

const configCompletionKinds: Record<ConfigCompletionKind, CompletionItemKind> = {
  block: CompletionItemKind.Module, item: CompletionItemKind.Snippet, attribute: CompletionItemKind.Property, value: CompletionItemKind.Value,
  memory: CompletionItemKind.Reference, segment: CompletionItemKind.Reference, symbol: CompletionItemKind.Constant,
};

connection.onCompletion((params): CompletionItem[] => {
  const trigger = params.context?.triggerCharacter;
  const config = configDocument(params.textDocument.uri);
  if (config) {
    const {line, character} = params.position;
    // A space only opens the list right after `=`, `:` or `,`.
    if (trigger === ' ' && !/[=:,]\s$/u.test(config.getText({start: {line, character: 0}, end: {line, character}}))) return [];
    return configCompletions(parsedConfig(config), line, character, configProject(toPath(config.uri))).map((item, index) => ({
      label: item.label, kind: configCompletionKinds[item.kind], ...(item.detail ? {detail: item.detail} : {}),
      ...(item.documentation ? {documentation: {kind: MarkupKind.Markdown, value: item.documentation}} : {}),
      ...(item.snippet ? {insertText: item.snippet, insertTextFormat: InsertTextFormat.Snippet} : {}),
      sortText: String(index).padStart(5, '0'),
    }));
  }
  if (trigger && !['.', '@'].includes(trigger)) return [];
  const items = completionsAt(workspace, pathOf(params.textDocument.uri), params.position.line, params.position.character);
  return items.map((item, index) => ({
    label: item.label, kind: completionKinds[item.kind], detail: item.detail,
    ...(item.documentation ? {documentation: {kind: MarkupKind.Markdown, value: item.documentation}} : {}),
    // Instructions first at the word position; nearer names first in an operand.
    sortText: String(index).padStart(5, '0'),
  }));
});

connection.onSignatureHelp(params => {
  if (configDocument(params.textDocument.uri)) return null;
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
  const config = configDocument(params.textDocument.uri);
  if (config) {
    const span = configDefinition(parsedConfig(config), params.position.line, params.position.character);
    return span ? {uri: config.uri, range: toRange(span)} : null;
  }
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

connection.onReferences(params => configDocument(params.textDocument.uri) ? [] : workspace.occurrences(pathOf(params.textDocument.uri), params.position.line, params.position.character, params.context.includeDeclaration).map(location));

connection.onDocumentHighlight(params => {
  if (configDocument(params.textDocument.uri)) return [];
  const path = pathOf(params.textDocument.uri);
  return workspace.occurrences(path, params.position.line, params.position.character)
    .filter(item => normalize(item.path) === normalize(path))
    .map(item => ({range: toRange(item.span), kind: DocumentHighlightKind.Text}));
});

/** The definition to rename at a position, refusing library symbols. */
function renameTarget(uri: string, line: number, character: number) {
  if (configDocument(uri)) throw new ResponseError(ErrorCodes.InvalidRequest, 'Rename works in assembly sources');
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

const configSymbolKinds: Record<ConfigOutlineSymbol['kind'], SymbolKind> = {
  block: SymbolKind.Namespace, memory: SymbolKind.Struct, segment: SymbolKind.Field, symbol: SymbolKind.Constant, item: SymbolKind.Property,
};

function toConfigSymbol(node: ConfigOutlineSymbol): DocumentSymbol {
  return {
    name: node.name, kind: configSymbolKinds[node.kind], ...(node.detail ? {detail: node.detail} : {}),
    range: {start: {line: node.span.line, character: 0}, end: {line: node.endLine, character: 1000}},
    selectionRange: toRange(node.span),
    children: node.children.map(toConfigSymbol),
  };
}

connection.onDocumentSymbol(params => {
  const config = configDocument(params.textDocument.uri);
  if (config) return configOutline(parsedConfig(config)).map(toConfigSymbol);
  return documentOutline(workspace, pathOf(params.textDocument.uri)).map(toDocumentSymbol);
});

connection.onWorkspaceSymbol(params => {
  const query = params.query.toLowerCase();
  return workspace.allSymbols()
    .filter(target => !workspace.get(target.path)?.library && target.symbol.kind !== 'import' && target.symbol.kind !== 'local' && qualifiedName(target.symbol).toLowerCase().includes(query))
    .slice(0, 500)
    .map(target => ({name: qualifiedName(target.symbol), kind: symbolKinds[target.symbol.kind], location: location({path: target.path, span: target.symbol.span})}));
});

connection.onFoldingRanges(params => {
  const config = configDocument(params.textDocument.uri);
  if (config) return parsedConfig(config).blocks.filter(block => block.closeLine > block.openLine).map(block => ({startLine: block.openLine, endLine: block.closeLine}));
  return (workspace.get(pathOf(params.textDocument.uri))?.parsed.folds ?? [])
    .filter(fold => fold.end > fold.start)
    .map(fold => ({startLine: fold.start, endLine: fold.end, ...(fold.kind ? {kind: FoldingRangeKind.Comment} : {})}));
});

connection.onDocumentLinks(params => {
  if (configDocument(params.textDocument.uri)) return [];
  const path = pathOf(params.textDocument.uri);
  return (workspace.get(path)?.parsed.includes ?? []).flatMap(include => {
    const target = workspace.resolveInclude(path, include.path) ?? (include.binary ? join(path, '..', include.path) : undefined);
    return target ? [{range: toRange(include.span), target: toUri(target)}] : [];
  });
});

documents.listen(connection);
connection.listen();
