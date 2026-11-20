import * as vscode from 'vscode';

export const DEBUG_TYPE = 'clementina';

// Custom requests the Clementina debug adapter answers; see packages/debug-adapter.
const SPEED_REQUEST = 'clementina.speed';
const SET_SPEED_REQUEST = 'clementina.setSpeed';

interface Speed {realtime: boolean; targetMHz: number; unthrottled: boolean; measuredMHz: number}

/** Speeds offered by the status bar picker, in MHz; 0 is unthrottled. */
const SPEEDS: readonly {mhz: number; label: string; detail?: string}[] = [
  {mhz: 1, label: '1 MHz'},
  {mhz: 1.2, label: '1.2 MHz', detail: 'MIA\'s default PHI2, the speed the board starts at'},
  {mhz: 2, label: '2 MHz'},
  {mhz: 4, label: '4 MHz'},
  {mhz: 8, label: '8 MHz', detail: 'Faster than the board; keeps up only on a fast computer'},
  {mhz: 0, label: 'As fast as possible', detail: 'No pacing: as fast as this computer can emulate'},
];

/** Fill a launch configuration from the settings, and let F5 work without a launch.json. */
class ClementinaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.ProviderResult<vscode.DebugConfiguration> {
    if (!config.type && !config.request && !config.name) {
      if (!folder) {
        void vscode.window.showErrorMessage('Open the folder of a Clementina project (the one with clementina.yaml) to debug it.');
        return undefined;
      }
      config = {type: DEBUG_TYPE, request: 'launch', name: 'Launch Clementina project', program: folder.uri.fsPath};
    }
    const settings = vscode.workspace.getConfiguration('clementina.debug', folder?.uri);
    const emulator = settings.get<string>('emulatorPath');
    const videoClient = settings.get<string>('videoClientPath');
    if (config.emulator === undefined && emulator) config.emulator = emulator;
    // No setting: the adapter starts at the project's target.phi2Hz (1.2 MHz by default).
    const speed = settings.get<number | null>('speed');
    if (config.speed === undefined && typeof speed === 'number') config.speed = speed;
    if (config.videoClient === undefined) config.videoClient = settings.get<boolean>('openVideoClient') === false ? false : videoClient || true;
    return config;
  }
}

/** Status bar speed of the running Clementina debug session; click it to change the speed. */
class SpeedStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.item.command = 'clementina.debug.setSpeed';
    this.item.tooltip = 'Clementina emulator speed: target and measured. Click to change it.';
  }

  /** Follow the active debug session. */
  update(): void {
    const session = vscode.debug.activeDebugSession;
    if (session?.type !== DEBUG_TYPE) { this.stop(); return; }
    if (!this.timer) this.timer = setInterval(() => { void this.refresh(); }, 1000);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const session = vscode.debug.activeDebugSession;
    if (session?.type !== DEBUG_TYPE) { this.stop(); return; }
    try {
      const speed = await session.customRequest(SPEED_REQUEST) as Speed;
      if (!speed.realtime) { this.item.hide(); return; }
      const target = speed.unthrottled ? 'max' : `${formatMhz(speed.targetMHz)} MHz`;
      this.item.text = `$(dashboard) ${target}` + (speed.measuredMHz > 0 ? ` · ${formatMhz(speed.measuredMHz)} MHz` : '');
      this.item.show();
    } catch {
      // The session is still starting or has ended.
      this.item.hide();
    }
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.item.hide();
  }

  dispose(): void { this.stop(); this.item.dispose(); }
}

function formatMhz(mhz: number): string {
  return mhz >= 10 ? mhz.toFixed(0) : mhz.toFixed(mhz < 1 ? 2 : 1);
}

/** Ask for a speed and send it to the running Clementina emulator. */
async function setSpeed(status: SpeedStatus): Promise<void> {
  const session = vscode.debug.activeDebugSession;
  if (session?.type !== DEBUG_TYPE) {
    void vscode.window.showInformationMessage('Start debugging a Clementina project first (F5).');
    return;
  }
  const picked = await vscode.window.showQuickPick(SPEEDS.map(speed => ({...speed})), {title: 'Clementina emulator speed'});
  if (!picked) return;
  try {
    await session.customRequest(SET_SPEED_REQUEST, {mhz: picked.mhz});
    await status.refresh();
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not change the speed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Debug configuration, speed status bar item and speed command. */
export function registerDebugSupport(context: vscode.ExtensionContext): void {
  const status = new SpeedStatus();
  context.subscriptions.push(
    status,
    vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, new ClementinaDebugConfigurationProvider()),
    vscode.debug.onDidChangeActiveDebugSession(() => status.update()),
    vscode.debug.onDidStartDebugSession(() => status.update()),
    vscode.debug.onDidTerminateDebugSession(() => status.update()),
    vscode.commands.registerCommand('clementina.debug.setSpeed', () => setSpeed(status)),
  );
}
