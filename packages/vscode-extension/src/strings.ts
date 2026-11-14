import * as vscode from 'vscode';
import type {LanguageClient} from 'vscode-languageclient/node';
import type {Range} from 'vscode-languageclient';

// The language server describes tags, glyphs and styles; this module only
// dims the tags and forwards the pickers' choices back to it.

interface Glyph {code: number; label: string; description: string; icon: string}
interface Styles {
  colors: {bank: number; word: string; name: string; icon: string}[];
  flags: {word: string; label: string; bit: number}[];
}

/** Dims the `{…}` tags the language server finds in every visible Clementina BASIC editor. */
export class TagDecorator implements vscode.Disposable {
  private readonly tags = vscode.window.createTextEditorDecorationType({opacity: '0.55'});
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly client: LanguageClient) {
    this.subscriptions = [
      vscode.window.onDidChangeVisibleTextEditors(editors => { for (const editor of editors) this.schedule(editor.document, 0); }),
      vscode.workspace.onDidChangeTextDocument(event => this.schedule(event.document, 200)),
    ];
    for (const editor of vscode.window.visibleTextEditors) this.schedule(editor.document, 0);
  }

  /** Coalesce redraws of one document while it is being typed in. */
  private schedule(document: vscode.TextDocument, delay: number): void {
    if (document.languageId !== 'clementina-basic') return;
    const key = document.uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(key, setTimeout(() => { this.pending.delete(key); void this.refresh(document); }, delay));
  }

  private async refresh(document: vscode.TextDocument): Promise<void> {
    if (!vscode.window.visibleTextEditors.some(editor => editor.document === document)) return;
    const version = document.version;
    let tags: Range[];
    try {
      tags = await this.client.sendRequest<Range[]>('clementina/basicTags', {textDocument: {uri: document.uri.toString()}});
    } catch {
      return;
    }
    // A newer edit has its own redraw scheduled.
    if (document.isClosed || document.version !== version) return;
    const ranges = tags.map(range => this.client.protocol2CodeConverter.asRange(range));
    for (const editor of vscode.window.visibleTextEditors.filter(item => item.document === document)) editor.setDecorations(this.tags, ranges);
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    for (const item of [...this.subscriptions, this.tags]) item.dispose();
  }
}

/** The active editor when it holds Clementina BASIC. */
function basicEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor?.document.languageId === 'clementina-basic' ? editor : undefined;
}

/** Pick a tile from the charset and insert its `{$hh}` tag at every selection. */
export async function insertGlyph(client: LanguageClient): Promise<void> {
  const editor = basicEditor();
  if (!editor) return;
  const glyphs = await client.sendRequest<Glyph[]>('clementina/basicGlyphs', {cellSize: 16});
  const pick = await vscode.window.showQuickPick(
    glyphs.map(glyph => ({label: glyph.label, description: glyph.description, iconPath: vscode.Uri.parse(glyph.icon)})),
    {title: 'Insert Clementina glyph', placeHolder: 'Type a tile code ($81) or a glyph-mode key', matchOnDescription: true},
  );
  if (!pick) return;
  await editor.edit(edit => { for (const selection of editor.selections) edit.replace(selection, `{${pick.label}}`); });
}

/** Pick a color and flags, and give them to the selected characters of quoted strings. */
export async function styleSelection(client: LanguageClient): Promise<void> {
  const editor = basicEditor();
  if (!editor) return;
  const styles = await client.sendRequest<Styles>('clementina/basicStyles', {cellSize: 16});
  const remove = {label: 'Remove styles', description: 'the whole string prints at the BASIC pen again', bank: -1};
  const color = await vscode.window.showQuickPick([
    ...styles.colors.map(item => ({label: item.word, description: item.name, iconPath: vscode.Uri.parse(item.icon), bank: item.bank})),
    {label: '', kind: vscode.QuickPickItemKind.Separator, bank: -1},
    remove,
  ], {title: 'Style selected text', placeHolder: 'Color for the selected characters (an empty selection styles its whole string)'});
  if (!color) return;
  let attribute: number | null = null;
  if (color !== remove) {
    const flags = await vscode.window.showQuickPick(
      styles.flags.map(flag => ({label: flag.label, description: `{${flag.word}}`, bit: flag.bit})),
      {title: 'Style selected text', placeHolder: 'Flips and reverse, or none', canPickMany: true},
    );
    if (!flags) return;
    attribute = flags.reduce((value, flag) => value | flag.bit, color.bank);
  }
  await client.sendRequest('workspace/executeCommand', {
    command: 'clementina.basic.styleStrings',
    arguments: [editor.document.uri.toString(), editor.selections.map(selection => client.code2ProtocolConverter.asRange(selection)), attribute],
  });
}
