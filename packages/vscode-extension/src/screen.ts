import {randomBytes} from 'crypto';
import * as vscode from 'vscode';
import type {LanguageClient} from 'vscode-languageclient/node';

// The language server lays out what lines print; this view only shows its image.

interface Screen {lines: number[]; image?: string; rows?: number; placeholders: boolean; notes: string[]}
/** What the page shows: everything but the image is text. */
interface Shown {label?: string; image?: string; rows?: number; text?: string; notes: string[]}

const HINT = 'Put the cursor on a line, or select lines, in a Clementina BASIC file to see what they print.';
const LEGEND = 'Dashed boxes are values only the running program knows, shown as they are written.';

/** "Line 20", or "Lines 20–30" for the first and last of several. */
function describeLines(lines: readonly number[]): string | undefined {
  if (lines.length === 0) return undefined;
  return lines.length === 1 ? `Line ${lines[0]}` : `Lines ${lines[0]}–${lines.at(-1)}`;
}

/** The Clementina Screen panel: what the lines under the active BASIC editor's selections print. */
export class ScreenView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'clementina.basic.screen';
  private view: vscode.WebviewView | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The latest preview, kept while another kind of editor is active and shown again when the page reloads. */
  private shown: Shown | undefined;
  private requests = 0;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly client: LanguageClient, private readonly started: Promise<void>) {
    this.subscriptions = [
      vscode.window.onDidChangeTextEditorSelection(event => this.schedule(event.textEditor)),
      vscode.window.onDidChangeActiveTextEditor(editor => this.schedule(editor, 0)),
      vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === event.document) this.schedule(editor);
      }),
    ];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {enableScripts: true};
    view.webview.html = page(randomBytes(16).toString('base64'));
    // The page says when it is ready, after the view first opens and whenever it reloads.
    view.webview.onDidReceiveMessage(() => {
      if (this.shown) void view.webview.postMessage(this.shown);
      this.schedule(vscode.window.activeTextEditor, 0);
    });
    view.onDidChangeVisibility(() => this.schedule(vscode.window.activeTextEditor, 0));
    view.onDidDispose(() => { this.view = undefined; });
  }

  /** Open the panel and leave the focus in the editor. */
  async reveal(): Promise<void> {
    if (this.view) return this.view.show(true);
    await vscode.commands.executeCommand(`${ScreenView.viewId}.focus`);
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  }

  /** Coalesce previews while the cursor moves or the document is typed in; nothing runs while the panel is hidden. */
  private schedule(editor: vscode.TextEditor | undefined, delay = 150): void {
    if (!this.view?.visible || editor?.document.languageId !== 'clementina-basic') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(editor), delay);
  }

  private async refresh(editor: vscode.TextEditor): Promise<void> {
    const request = ++this.requests;
    let screen: Screen;
    try {
      await this.started;
      screen = await this.client.sendRequest<Screen>('clementina/basicScreen', {
        textDocument: {uri: editor.document.uri.toString()},
        ranges: editor.selections.map(selection => this.client.code2ProtocolConverter.asRange(selection)),
      });
    } catch {
      return;
    }
    // A newer selection or edit has asked again.
    if (request !== this.requests) return;
    const label = describeLines(screen.lines);
    if (!label) this.shown = {text: HINT, notes: screen.notes};
    else if (!screen.image) this.shown = {text: `${label} ${screen.lines.length === 1 ? 'prints' : 'print'} nothing.`, notes: screen.notes};
    else this.shown = {label, image: screen.image, rows: screen.rows, ...(screen.placeholders ? {text: LEGEND} : {}), notes: screen.notes};
    void this.view?.webview.postMessage(this.shown);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const item of this.subscriptions) item.dispose();
  }
}

/** The view's page: a label, the screen at the largest whole scale that fits, and text below it. */
function page(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { margin: 0; padding: 8px 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  p, ul { margin: 0; }
  #label { margin-bottom: 6px; color: var(--vscode-descriptionForeground); }
  #screen { display: block; }
  #text { margin-top: 6px; color: var(--vscode-descriptionForeground); }
  #notes { margin-top: 6px; padding-left: 1.2em; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<p id="label" hidden></p>
<img id="screen" alt="What the lines print on the Clementina screen" hidden>
<p id="text">${HINT}</p>
<ul id="notes"></ul>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const [label, screen, text, notes] = ['label', 'screen', 'text', 'notes'].map(id => document.getElementById(id));
  let rows = 0;
  // 40 columns of 8 pixels, scaled whole so every screen pixel stays square.
  function fit() {
    if (!rows) return;
    const width = document.documentElement.clientWidth - 24;
    const height = window.innerHeight - screen.offsetTop - text.offsetHeight - notes.offsetHeight - 20;
    const scale = Math.max(1, Math.floor(Math.min(width / 320, height / (rows * 8))));
    screen.width = 320 * scale;
    screen.height = rows * 8 * scale;
  }
  window.addEventListener('message', event => {
    const shown = event.data;
    label.textContent = shown.label ?? '';
    label.hidden = !shown.label;
    rows = shown.rows ?? 0;
    screen.hidden = !shown.image;
    if (shown.image) screen.src = shown.image;
    text.textContent = shown.text ?? '';
    text.hidden = !shown.text;
    notes.replaceChildren(...shown.notes.map(note => Object.assign(document.createElement('li'), {textContent: note})));
    fit();
  });
  window.addEventListener('resize', fit);
  vscode.postMessage('ready');
</script>
</body>
</html>`;
}
