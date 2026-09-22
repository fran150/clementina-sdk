import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  CompletionItemKind,
  MarkupKind,
  type Diagnostic,
  type CompletionItem,
  type Hover,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {analyzeDiagnostics, completionsFor, hoverAt} from './index.js';

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    hoverProvider: true,
    completionProvider: {},
  },
}));

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').split('\n');
}

function validate(document: TextDocument): void {
  const text = document.getText();
  const lines = splitLines(text);
  const diagnostics: Diagnostic[] = analyzeDiagnostics(text).map(item => ({
    severity: DiagnosticSeverity.Error,
    range: {
      start: {line: item.line - 1, character: 0},
      end: {line: item.line - 1, character: lines[item.line - 1]?.length ?? 0},
    },
    message: item.message,
    source: 'clementina-basic',
    code: item.code,
  }));
  connection.sendDiagnostics({uri: document.uri, diagnostics});
}

documents.onDidOpen(event => validate(event.document));
documents.onDidChangeContent(event => validate(event.document));
documents.onDidClose(event => connection.sendDiagnostics({uri: event.document.uri, diagnostics: []}));

connection.onHover((params): Hover | undefined => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return undefined;
  const info = hoverAt(document.getText(), params.position.line + 1, params.position.character);
  if (!info) return undefined;
  return {contents: {kind: MarkupKind.Markdown, value: `**${info.keyword}** — ${info.category} token \`${info.token}\``}};
});

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const lineText = splitLines(document.getText())[params.position.line] ?? '';
  const before = lineText.slice(0, params.position.character);
  const prefix = /[A-Za-z]*$/u.exec(before)![0];
  return completionsFor(prefix).map(item => ({label: item.keyword, kind: CompletionItemKind.Keyword, detail: item.category}));
});

documents.listen(connection);
connection.listen();
