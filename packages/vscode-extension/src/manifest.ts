import * as path from 'path';
import * as vscode from 'vscode';
import {checkManifestText, manifestPathCandidates, manifestPathFieldAt} from '@clementina/project/node';

/** clementina.yaml in any folder, however the editor names its language. */
const MANIFEST: vscode.DocumentFilter = {scheme: 'file', pattern: '**/clementina.yaml'};
const isManifest = (document: vscode.TextDocument): boolean => document.uri.scheme === 'file' && path.basename(document.uri.fsPath) === 'clementina.yaml';

/**
 * Editing clementina.yaml: the SDK's own checks as you type (missing files,
 * slots, banks, unknown IDs, out-of-range hex addresses) and completion of the
 * paths in `assets`, `program.entry` and `build.assembly`. Field completion,
 * hover and schema errors come from the YAML extension with the project schema
 * (package.json contributes.yamlValidation).
 */
export function registerManifestSupport(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('clementina-manifest');
  const timers = new Map<string, NodeJS.Timeout>();
  const check = async (document: vscode.TextDocument): Promise<void> => {
    const root = path.dirname(document.uri.fsPath), version = document.version;
    let found;
    try { found = await checkManifestText(root, document.getText()); } catch { return; }
    if (document.isClosed || document.version !== version) return;
    collection.set(document.uri, found.map(d => {
      const range = new vscode.Range(d.start.line, d.start.character, d.end.line, Math.max(d.end.character, d.start.line === d.end.line ? d.start.character + 1 : 0));
      const diagnostic = new vscode.Diagnostic(range, d.message, d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'clementina';
      diagnostic.code = d.code;
      return diagnostic;
    }));
  };
  const schedule = (document: vscode.TextDocument): void => {
    if (!isManifest(document)) return;
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); void check(document); }, 300));
  };
  // A file the manifest names may appear or go away: check every open manifest again.
  const recheckAll = (): void => { for (const document of vscode.workspace.textDocuments) schedule(document); };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    collection, watcher,
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument(event => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument(document => collection.delete(document.uri)),
    watcher.onDidCreate(recheckAll), watcher.onDidDelete(recheckAll),
    vscode.languages.registerCompletionItemProvider(MANIFEST, {provideCompletionItems: completePaths}, ' ', '/', '-'),
    {dispose: () => { for (const timer of timers.values()) clearTimeout(timer); }},
  );
  recheckAll();
}

/** Offer the project's files that fit the path field under the cursor. */
async function completePaths(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
  const field = manifestPathFieldAt(document.getText(), position.line, position.character);
  if (!field) return [];
  const root = path.dirname(document.uri.fsPath);
  const output = /^\s*outputDirectory\s*:\s*(\S+)/mu.exec(document.getText())?.[1] ?? 'build';
  const listed = new Set(document.getText().split(/\r?\n/u).map(line => /^\s*(?:-\s+|[A-Za-z]+\s*:\s*)(\S+)\s*$/u.exec(line)?.[1]));
  const line = document.lineAt(position.line).text.slice(0, position.character);
  const start = line.search(/\S*$/u);
  const range = new vscode.Range(position.line, start, position.line, position.character);
  return (await manifestPathCandidates(root, field, output)).map((candidate, index) => {
    const item = new vscode.CompletionItem(candidate, field.kind === 'directory' ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
    item.range = range;
    item.detail = listed.has(candidate) ? 'already in the manifest' : field.key;
    item.sortText = `${listed.has(candidate) ? 1 : 0}${String(index).padStart(4, '0')}`;
    return item;
  });
}
