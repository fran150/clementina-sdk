import * as path from 'path';
import * as vscode from 'vscode';
import {LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind} from 'vscode-languageclient/node';

const DEBUG_TYPE = 'clementina';

let languageClient: LanguageClient | undefined;

function resolveBin(packageName: string, binName: string): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  return path.join(path.dirname(packageJsonPath), 'bin', binName);
}

class ClementinaDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterExecutable(process.execPath, [resolveBin('@clementina/debug-adapter', 'clementina-debug-adapter.mjs')]);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, new ClementinaDebugAdapterDescriptorFactory()),
  );

  const lspBin = resolveBin('@clementina/basic-lsp', 'clementina-basic-lsp.mjs');
  const run = {command: process.execPath, args: [lspBin], transport: TransportKind.stdio};
  const serverOptions: ServerOptions = {run, debug: run};
  const clientOptions: LanguageClientOptions = {documentSelector: [{scheme: 'file', language: 'clementina-basic'}]};
  languageClient = new LanguageClient('clementinaBasic', 'Clementina BASIC Language Server', serverOptions, clientOptions);
  void languageClient.start();
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
}

export function deactivate(): Thenable<void> | undefined {
  return languageClient?.stop();
}
