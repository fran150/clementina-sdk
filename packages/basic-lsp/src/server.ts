import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  CompletionItemKind,
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
  type SignatureHelp,
  type Range,
} from 'vscode-languageserver/node.js';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {errorMessage} from '@clementina/core';
import {
  analyzeDiagnostics,
  completionsAt,
  definitionAt,
  documentSymbols,
  formatBasicSource,
  hoverAt,
  referencesAt,
  renameAt,
  renumberBasicSource,
  semanticSpans,
  signatureHelpAt,
  type BasicSourceLocation,
} from './index.js';
import {splitPhysicalLines} from './source.js';

const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    hoverProvider: true,
    completionProvider: {},
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
    executeCommandProvider: {commands: ['clementina.basic.renumber']},
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
    severity: DiagnosticSeverity.Error,
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
  return completionsAt(document.getText(), params.position.line + 1, params.position.character)
    .map(item => ({label: item.keyword, kind: item.category === 'variable' ? CompletionItemKind.Variable : CompletionItemKind.Keyword, detail: item.category}));
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
    signatures: [{label: info.label, parameters: info.parameters.map(label => ({label}))}],
    activeSignature: 0,
    activeParameter: info.activeParameter,
  };
});

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

connection.onExecuteCommand(async params => {
  if (params.command !== 'clementina.basic.renumber') return undefined;
  const [uri, start = 10, step = 10] = params.arguments ?? [];
  if (typeof uri !== 'string' || typeof start !== 'number' || typeof step !== 'number') return false;
  const document = documents.get(uri);
  if (!document) return false;
  try {
    const newText = renumberBasicSource(document.getText(), {start, step});
    const response = await connection.workspace.applyEdit({changes: {[uri]: [TextEdit.replace(wholeDocumentRange(document), newText)]}});
    return response.applied;
  } catch {
    return false;
  }
});

documents.listen(connection);
connection.listen();
