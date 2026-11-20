import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind} from 'vscode-languageclient/node';
import {DEBUG_TYPE, registerDebugSupport} from './debug';
import {registerManifestSupport} from './manifest';
import {ScreenView} from './screen';
import {insertGlyph, styleSelection, TagDecorator} from './strings';

let languageClient: LanguageClient | undefined;
let asmClient: LanguageClient | undefined;

// scripts/bundle.mjs places the bundled servers next to this file.
function serverPath(name: string): string {
  return path.join(__dirname, `${name}.mjs`);
}

class ClementinaDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterExecutable(process.execPath, [serverPath('debug-adapter')]);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, new ClementinaDebugAdapterDescriptorFactory()),
  );
  registerDebugSupport(context);

  const run = {command: process.execPath, args: [serverPath('basic-lsp')], transport: TransportKind.stdio};
  const serverOptions: ServerOptions = {run, debug: run};
  const clientOptions: LanguageClientOptions = {documentSelector: [{scheme: 'file', language: 'clementina-basic'}]};
  const client = languageClient = new LanguageClient('clementinaBasic', 'Clementina BASIC Language Server', serverOptions, clientOptions);
  const started = client.start();
  void started.then(() => { context.subscriptions.push(new TagDecorator(client)); });
  const screen = new ScreenView(client, started);
  context.subscriptions.push(
    screen,
    vscode.window.registerWebviewViewProvider(ScreenView.viewId, screen),
    vscode.commands.registerCommand('clementina.basic.insertGlyph', () => insertGlyph(client)),
    vscode.commands.registerCommand('clementina.basic.styleSelection', () => styleSelection(client)),
    vscode.commands.registerCommand('clementina.basic.showScreen', () => screen.reveal()),
  );
  context.subscriptions.push(vscode.commands.registerCommand('clementina.basic.renumberInteractive', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'clementina-basic') return;
    const startText = await vscode.window.showInputBox({
      title: 'Renumber Clementina BASIC', prompt: 'First line number', value: '10',
      validateInput: value => /^(?:0|[1-9][0-9]*)$/u.test(value) && Number(value) <= 63999 ? undefined : 'Enter an integer from 0 through 63999',
    });
    if (startText === undefined) return;
    const stepText = await vscode.window.showInputBox({
      title: 'Renumber Clementina BASIC', prompt: 'Line-number increment', value: '10',
      validateInput: value => /^[1-9][0-9]*$/u.test(value) ? undefined : 'Enter a positive integer',
    });
    if (stepText === undefined) return;
    await languageClient?.sendRequest('workspace/executeCommand', {
      command: 'clementina.basic.renumber',
      arguments: [editor.document.uri.toString(), Number(startText), Number(stepText)],
    });
  }));
  context.subscriptions.push({dispose: () => { void languageClient?.stop(); }});
  startAssemblyServer(context);
  registerManifestSupport(context);
}

/**
 * The ca65 language server: hover, completion, navigation, outline and ca65's
 * errors for .s and .inc files, and the same server's support for ld65 linker
 * configurations (link.cfg).
 */
function startAssemblyServer(context: vscode.ExtensionContext): void {
  const run = {command: process.execPath, args: [serverPath('asm-lsp')], transport: TransportKind.stdio};
  const settings = vscode.workspace.getConfiguration('clementina.assembly');
  const version = String((context.extension.packageJSON as {version?: unknown}).version ?? 'dev');
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{scheme: 'file', language: 'clementina-asm'}, {scheme: 'file', language: 'clementina-ld65'}],
    initializationOptions: {
      // The library's sources are written here so go to definition can open them.
      libraryDirectory: path.join(context.globalStorageUri.fsPath, 'library', version),
      ca65Path: settings.get<string>('ca65Path') || undefined,
      ld65Path: settings.get<string>('ld65Path') || undefined,
      diagnostics: settings.get<string>('diagnostics') ?? 'onType',
    },
    synchronize: {
      configurationSection: 'clementina',
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.{s,inc,asm,lbl}'),
        vscode.workspace.createFileSystemWatcher('**/clementina.yaml'),
      ],
    },
  };
  asmClient = new LanguageClient('clementinaAssembly', 'Clementina Assembly Language Server', {run, debug: run}, clientOptions);
  void asmClient.start();
  context.subscriptions.push({dispose: () => { void asmClient?.stop(); }});
  adoptLinkerConfigs(context);
}

/**
 * Open a project's linker configuration (`build.assembly.linkerConfig`) as
 * ld65 even when its name is not one the language claims, such as `game.cfg`.
 */
function adoptLinkerConfigs(context: vscode.ExtensionContext): void {
  const check = (document: vscode.TextDocument) => {
    if (document.uri.scheme !== 'file' || document.languageId === 'clementina-ld65' || path.extname(document.fileName).toLowerCase() !== '.cfg') return;
    if (linkerConfigOf(document.fileName)) void vscode.languages.setTextDocumentLanguage(document, 'clementina-ld65');
  };
  vscode.workspace.textDocuments.forEach(check);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(check));
}

/** True when the nearest clementina.yaml above a file names it as its linkerConfig. */
function linkerConfigOf(file: string): boolean {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const manifest = path.join(directory, 'clementina.yaml');
    if (fs.existsSync(manifest)) {
      try {
        const match = /^\s+linkerConfig:\s*["']?([^"'#\s]+)/mu.exec(fs.readFileSync(manifest, 'utf8'));
        return !!match && path.resolve(directory, match[1]!) === path.resolve(file);
      } catch {
        return false;
      }
    }
    if (path.dirname(directory) === directory) return false;
  }
}

export async function deactivate(): Promise<void> {
  await Promise.all([languageClient?.stop(), asmClient?.stop()]);
}
