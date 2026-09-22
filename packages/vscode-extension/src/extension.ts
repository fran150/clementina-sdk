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
  context.subscriptions.push({dispose: () => { void languageClient?.stop(); }});
}

export function deactivate(): Thenable<void> | undefined {
  return languageClient?.stop();
}
