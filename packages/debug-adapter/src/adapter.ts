import {basename} from 'node:path';
import {
  DebugSession,
  InitializedEvent,
  StoppedEvent,
  TerminatedEvent,
  Thread,
  StackFrame,
  Scope,
  Variable,
  Breakpoint,
  Source,
} from '@vscode/debugadapter';
import type {DebugProtocol} from '@vscode/debugprotocol';
import {createProjectDebugSession, type ProjectDebugRuntime} from '@clementina/debug/node';
import type {DebugSnapshot} from '@clementina/debug';

const THREAD_ID = 1;
const FRAME_ID = 1;
const REGISTERS_SCOPE_REF = 1;

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  /** Portable project root. */
  program: string;
  emulator?: string;
  port?: number;
}

const hex = (value: number, width = 2): string => `$${value.toString(16).toUpperCase().padStart(width, '0')}`;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Thin DAP translation over `ClementinaDebugSession`/`createProjectDebugSession`.
 * No debugging logic lives here — every capability is a direct call into
 * `@clementina/debug`, which already owns breakpoint ownership, stepping, and
 * stop polling.
 */
export class ClementinaDebugAdapter extends DebugSession {
  /**
   * Overridable for tests. Not a constructor parameter: `DebugSession.run()`
   * always instantiates via `new debugSession(false)` (a legacy positional
   * flag inherited from the base class), so a constructor parameter here
   * would silently receive `false` instead of a real default.
   */
  createSession: typeof createProjectDebugSession = createProjectDebugSession;
  private runtime?: ProjectDebugRuntime;
  /** Set synchronously when `launchRequest` starts, so a concurrent `setBreakpoints` (real DAP clients, including VS Code, pipeline it alongside `launch` rather than waiting) can await the same in-flight preparation instead of seeing no session yet. */
  private launched?: Promise<ProjectDebugRuntime>;
  private lastSnapshot?: DebugSnapshot;
  private polling = false;

  constructor() {
    super();
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  protected override initializeRequest(response: DebugProtocol.InitializeResponse): void {
    response.body = response.body ?? {};
    response.body.supportsConfigurationDoneRequest = true;
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected override async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): Promise<void> {
    this.launched = this.prepareSession(args);
    try {
      this.runtime = await this.launched;
      this.sendResponse(response);
    } catch (error) {
      this.sendErrorResponse(response, 1, errorMessage(error));
    }
  }

  private async prepareSession(args: LaunchRequestArguments): Promise<ProjectDebugRuntime> {
    const built = await this.createSession(args.program, {
      ...(args.emulator === undefined ? {} : {executable: args.emulator}),
      ...(args.port === undefined ? {} : {port: args.port}),
    });
    if (!built.ok) throw new Error(built.diagnostics.map(d => d.message).join('; ') || 'Failed to prepare the debug session');
    return built.value;
  }

  /** Resolves once launch preparation has settled, `undefined` if never launched or launch failed. Never rejects. */
  private async ready(): Promise<ProjectDebugRuntime | undefined> {
    if (this.runtime) return this.runtime;
    if (!this.launched) return undefined;
    try { return await this.launched; } catch { return undefined; }
  }

  private async guard(response: DebugProtocol.Response, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.sendErrorResponse(response, 1, errorMessage(error));
    }
  }

  protected override setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
    return this.guard(response, async () => {
      const path = args.source.path;
      const runtime = path ? await this.ready() : undefined;
      if (!runtime || !path) {
        response.body = {breakpoints: []};
        this.sendResponse(response);
        return;
      }
      const lines = args.breakpoints?.map(b => b.line) ?? args.lines ?? [];
      const resolved = await runtime.session.setSourceBreakpoints(path, lines);
      response.body = {
        breakpoints: resolved.map(item => {
          const breakpoint = new Breakpoint(item.verified, item.line, undefined, new Source(basename(path), path));
          if (item.message) (breakpoint as DebugProtocol.Breakpoint).message = item.message;
          return breakpoint;
        }),
      };
      this.sendResponse(response);
    });
  }

  protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
    this.sendResponse(response);
    void this.ready().then(async runtime => {
      if (!runtime) return;
      await runtime.launch();
      this.pollForStop();
    });
  }

  protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {threads: [new Thread(THREAD_ID, 'Clementina 65C02')]};
    this.sendResponse(response);
  }

  protected override stackTraceRequest(response: DebugProtocol.StackTraceResponse): Promise<void> {
    return this.guard(response, async () => {
      const snapshot = await this.currentSnapshot();
      const frame = snapshot.frame;
      const source = frame.source ? new Source(basename(frame.source.path), frame.source.path) : undefined;
      response.body = {stackFrames: [new StackFrame(FRAME_ID, frame.name, source, frame.source?.line ?? 0)], totalFrames: 1};
      this.sendResponse(response);
    });
  }

  protected override scopesRequest(response: DebugProtocol.ScopesResponse): void {
    response.body = {scopes: [new Scope('Registers', REGISTERS_SCOPE_REF, false)]};
    this.sendResponse(response);
  }

  protected override variablesRequest(response: DebugProtocol.VariablesResponse): Promise<void> {
    return this.guard(response, async () => {
      const {registers: r} = await this.currentSnapshot();
      response.body = {
        variables: [
          new Variable('PC', hex(r.pc, 4)),
          new Variable('A', hex(r.a)),
          new Variable('X', hex(r.x)),
          new Variable('Y', hex(r.y)),
          new Variable('SP', hex(r.sp)),
          new Variable('P', hex(r.p)),
          new Variable('cycles', r.cycles),
          new Variable('MIA paused', String(r.miaPaused)),
        ],
      };
      this.sendResponse(response);
    });
  }

  protected override continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime) { this.sendResponse(response); return; }
      await runtime.session.continue();
      this.sendResponse(response);
      this.pollForStop();
    });
  }

  protected override pauseRequest(response: DebugProtocol.PauseResponse): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime) { this.sendResponse(response); return; }
      this.lastSnapshot = await runtime.session.pause();
      this.sendResponse(response);
      this.sendEvent(new StoppedEvent('pause', THREAD_ID));
    });
  }

  protected override nextRequest(response: DebugProtocol.NextResponse): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime) { this.sendResponse(response); return; }
      await runtime.session.next();
      this.lastSnapshot = await runtime.session.snapshot();
      this.sendResponse(response);
      this.sendEvent(new StoppedEvent('step', THREAD_ID));
    });
  }

  protected override stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime) { this.sendResponse(response); return; }
      await runtime.session.stepIn();
      this.lastSnapshot = await runtime.session.snapshot();
      this.sendResponse(response);
      this.sendEvent(new StoppedEvent('step', THREAD_ID));
    });
  }

  protected override disconnectRequest(response: DebugProtocol.DisconnectResponse): Promise<void> {
    return this.guard(response, async () => {
      if (this.runtime) await this.runtime.close().catch(() => undefined);
      this.sendResponse(response);
    });
  }

  protected override terminateRequest(response: DebugProtocol.TerminateResponse): Promise<void> {
    return this.guard(response, async () => {
      if (this.runtime) await this.runtime.close().catch(() => undefined);
      this.sendResponse(response);
      this.sendEvent(new TerminatedEvent());
    });
  }

  private async currentSnapshot(): Promise<DebugSnapshot> {
    if (this.lastSnapshot) return this.lastSnapshot;
    const runtime = await this.ready();
    if (!runtime) throw new Error('No active debug session');
    return this.lastSnapshot = await runtime.session.snapshot();
  }

  /**
   * Poll for the next stop after an open-ended `continue`/`launch`, without
   * blocking other queued session commands (`waitForStop` is designed for
   * exactly this). A `pause` request already sends its own `StoppedEvent`
   * directly; this poll may then resolve redundantly once it observes the
   * same stop — harmless, VS Code treats a repeat `StoppedEvent` as a no-op.
   */
  private pollForStop(): void {
    if (this.polling || !this.runtime) return;
    this.polling = true;
    this.runtime.session.waitForStop({timeoutMs: 24 * 60 * 60 * 1000, pollIntervalMs: 25})
      .then(snapshot => {
        this.lastSnapshot = snapshot;
        this.sendEvent(new StoppedEvent(snapshot.state.stopReason === 'breakpoint' ? 'breakpoint' : 'step', THREAD_ID));
      })
      .catch(() => undefined)
      .finally(() => { this.polling = false; });
  }
}
