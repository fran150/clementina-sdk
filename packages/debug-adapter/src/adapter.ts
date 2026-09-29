import {resolve} from 'node:path';
import {
  DebugSession,
  InitializedEvent,
  StoppedEvent,
  TerminatedEvent,
  OutputEvent,
  Thread,
  Scope,
} from '@vscode/debugadapter';
import type {DebugProtocol} from '@vscode/debugprotocol';
import {errorMessage} from '@clementina/core';
import {createProjectDebugSession, type ProjectDebugRuntime} from '@clementina/debug/node';
import type {DebugSnapshot} from '@clementina/debug';
import {breakpointPath, dapBreakpoints, dapInstructions, dapStackFrames, disassemblyRange, registerVariables} from './protocol.js';

const THREAD_ID = 1;
const REGISTERS_SCOPE_REF = 1;
const BASIC_VARIABLES_SCOPE_REF = 2;

/** Launch settings accepted from a DAP client. */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  /** Portable project root. */
  program: string;
  /** Optional emulator automation executable. */
  emulator?: string;
  /** Optional loopback automation port. */
  port?: number;
}

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
  /** Let breakpoint requests share in-flight launch preparation. */
  private launched?: Promise<ProjectDebugRuntime>;
  private lastSnapshot?: DebugSnapshot;
  private stopWait?: AbortController;
  private projectRoot?: string;
  private stopping = false;
  private closing?: Promise<void>;
  private launchGeneration = 0;

  /** Configure the DAP session to use one-based source coordinates. */
  constructor() {
    super();
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  /** Advertise the DAP requests implemented by this adapter. */
  protected override initializeRequest(response: DebugProtocol.InitializeResponse): void {
    response.body = response.body ?? {};
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsEvaluateForHovers = true;
    response.body.supportsDisassembleRequest = true;
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  /** Prepare a project runtime while allowing pipelined breakpoint requests to wait for it. */
  protected override async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): Promise<void> {
    const generation = ++this.launchGeneration;
    this.cancelStopWait();
    this.projectRoot = resolve(args.program);
    this.stopping = false;
    this.runtime = undefined;
    this.lastSnapshot = undefined;
    this.closing = undefined;
    this.launched = this.prepareSession(args);
    try {
      const runtime = await this.launched;
      if (this.stopping || generation !== this.launchGeneration) {
        await runtime.close().catch(() => undefined);
        this.sendErrorResponse(response, 1, 'Debug session was stopped during preparation');
        return;
      }
      this.runtime = runtime;
      this.sendResponse(response);
    } catch (error) {
      this.sendErrorResponse(response, 1, errorMessage(error));
    }
  }

  /** Build the project and return its owned, stopped emulator runtime. */
  private async prepareSession(args: LaunchRequestArguments): Promise<ProjectDebugRuntime> {
    const built = await this.createSession(args.program, {
      ...(args.emulator === undefined ? {} : {executable: args.emulator}),
      ...(args.port === undefined ? {} : {port: args.port}),
    });
    if (!built.ok) throw new Error(built.diagnostics.map(d => d.message).join('; ') || 'Failed to prepare the debug session');
    return built.value;
  }

  /** Return the current runtime after preparation, or undefined if launch did not succeed. Never reject. */
  private async ready(): Promise<ProjectDebugRuntime | undefined> {
    if (this.stopping) return undefined;
    if (this.runtime) return this.runtime;
    if (!this.launched) return undefined;
    const generation = this.launchGeneration;
    const launched = this.launched;
    try {
      const runtime = await launched;
      return this.stopping || generation !== this.launchGeneration ? undefined : runtime;
    } catch {
      return undefined;
    }
  }

  /** Close the active runtime at most once, ignoring cleanup failures. */
  private closeRuntime(): Promise<void> {
    if (!this.runtime) return Promise.resolve();
    return this.closing ??= this.runtime.close().then(() => undefined, () => undefined);
  }

  /** Report a rejected request action as a DAP error response. */
  private async guard(response: DebugProtocol.Response, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.sendErrorResponse(response, 1, errorMessage(error));
    }
  }

  /** Replace breakpoints for one source file after launch preparation. */
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
      const resolved = await runtime.session.setSourceBreakpoints(breakpointPath(this.projectRoot, path), lines);
      response.body = {breakpoints: dapBreakpoints(path, resolved)};
      this.sendResponse(response);
    });
  }

  /** Acknowledge configuration and begin execution in the prepared runtime. */
  protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
    this.sendResponse(response);
    void this.startPreparedRuntime();
  }

  /** Start execution and surface startup errors as output plus termination events. */
  private async startPreparedRuntime(): Promise<void> {
    const runtime = await this.ready();
    if (!runtime) return;
    try {
      await runtime.launch();
      if (!this.stopping) this.pollForStop();
    } catch (error) {
      if (!this.stopping) {
        this.stopping = true;
        this.sendEvent(new OutputEvent(`Launch failed: ${errorMessage(error)}\n`, 'stderr'));
        this.sendEvent(new TerminatedEvent());
      }
      await this.closeRuntime();
    }
  }

  /** Return the single CPU thread exposed to DAP clients. */
  protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {threads: [new Thread(THREAD_ID, 'Clementina 65C02')]};
    this.sendResponse(response);
  }

  /** Return source-aware frames and any unknown-caller boundary. */
  protected override stackTraceRequest(response: DebugProtocol.StackTraceResponse): Promise<void> {
    return this.guard(response, async () => {
      const snapshot = await this.currentSnapshot();
      const runtime = await this.ready();
      const stack = runtime && 'stackTrace' in runtime.session ? await runtime.session.stackTrace() : {frames: [snapshot.frame], unknownCaller: false};
      const frames = dapStackFrames(stack);
      response.body = {stackFrames: frames, totalFrames: frames.length};
      this.sendResponse(response);
    });
  }

  /** Validate and translate a forward disassembly request. */
  protected override disassembleRequest(response: DebugProtocol.DisassembleResponse, args: DebugProtocol.DisassembleArguments): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime || !('disassemble' in runtime.session)) throw new Error('Assembly debug session required for disassembly');
      const range = disassemblyRange(args);
      const decoded = await runtime.session.disassemble(range.address, range.count + range.skip, range.bank);
      response.body = {instructions: dapInstructions(decoded, range)};
      this.sendResponse(response);
    });
  }

  /** Expose registers and, for BASIC sessions, decoded simple variables. */
  protected override scopesRequest(response: DebugProtocol.ScopesResponse): void {
    const scopes = [new Scope('Registers', REGISTERS_SCOPE_REF, false)];
    if (this.runtime && 'variables' in this.runtime.session) scopes.push(new Scope('BASIC Variables', BASIC_VARIABLES_SCOPE_REF, false));
    response.body = {scopes};
    this.sendResponse(response);
  }

  /** Read the selected variable scope from the shared debug session. */
  protected override variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
    return this.guard(response, async () => {
      if (args.variablesReference === BASIC_VARIABLES_SCOPE_REF) {
        const runtime = await this.ready();
        const variables = runtime && 'variables' in runtime.session ? await runtime.session.variables() : [];
        response.body = {variables: variables.map(item => ({
          name: item.name,
          value: item.value,
          type: item.type,
          variablesReference: 0,
        }))};
        this.sendResponse(response);
        return;
      }
      const {registers} = await this.currentSnapshot();
      response.body = {variables: registerVariables(registers)};
      this.sendResponse(response);
    });
  }

  /** Evaluate a BASIC variable name when the session supports it. */
  protected override evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      const value = runtime && 'evaluate' in runtime.session ? await runtime.session.evaluate(args.expression) : undefined;
      response.body = value
        ? {result: value.value, type: value.type, variablesReference: 0}
        : {result: 'Expression evaluation is available for BASIC variables', variablesReference: 0};
      this.sendResponse(response);
    });
  }

  /** Resume execution and wait asynchronously for its next stop. */
  protected override continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime) { this.sendResponse(response); return; }
      this.cancelStopWait();
      this.lastSnapshot = undefined;
      await runtime.session.continue();
      this.sendResponse(response);
      this.pollForStop();
    });
  }

  /** Pause execution and report the stopped snapshot. */
  protected override pauseRequest(response: DebugProtocol.PauseResponse): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime) { this.sendResponse(response); return; }
      this.cancelStopWait();
      this.lastSnapshot = await runtime.session.pause();
      this.sendResponse(response);
      this.sendEvent(new StoppedEvent('pause', THREAD_ID));
    });
  }

  /** Step over the next source location. */
  protected override nextRequest(response: DebugProtocol.NextResponse): Promise<void> {
    return this.step(response, 'next');
  }

  /** Step into the next source location. */
  protected override stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
    return this.step(response, 'stepIn');
  }

  /** Run either source-step command and report its stopped state. */
  private step(response: DebugProtocol.Response, command: 'next' | 'stepIn'): Promise<void> {
    return this.guard(response, async () => {
      const runtime = await this.ready();
      if (!runtime) { this.sendResponse(response); return; }
      this.cancelStopWait();
      this.lastSnapshot = undefined;
      const stepped = await runtime.session[command]();
      this.lastSnapshot = await runtime.session.snapshot();
      this.sendResponse(response);
      if (stepped.state.stopReason !== 'pause') this.sendEvent(new StoppedEvent('step', THREAD_ID));
    });
  }

  /** Stop accepting launch work and close the current runtime. */
  protected override disconnectRequest(response: DebugProtocol.DisconnectResponse): Promise<void> {
    this.stopping = true;
    this.launchGeneration++;
    this.cancelStopWait();
    return this.guard(response, async () => {
      await this.closeRuntime();
      this.sendResponse(response);
    });
  }

  /** Close the runtime and notify the client that debugging ended. */
  protected override terminateRequest(response: DebugProtocol.TerminateResponse): Promise<void> {
    this.stopping = true;
    this.launchGeneration++;
    this.cancelStopWait();
    return this.guard(response, async () => {
      await this.closeRuntime();
      this.sendResponse(response);
      this.sendEvent(new TerminatedEvent());
    });
  }

  /** Reuse the most recent stopped snapshot or fetch one from the session. */
  private async currentSnapshot(): Promise<DebugSnapshot> {
    if (this.lastSnapshot) return this.lastSnapshot;
    const runtime = await this.ready();
    if (!runtime) throw new Error('No active debug session');
    return this.lastSnapshot = await runtime.session.snapshot();
  }

  /** Abort an old wait so it cannot report a stale stop after another command. */
  private cancelStopWait(): void {
    this.stopWait?.abort();
    this.stopWait = undefined;
  }

  /** Poll after launch or continue without blocking other session commands. */
  private pollForStop(): void {
    if (!this.runtime || this.stopping) return;
    this.cancelStopWait();
    const wait = new AbortController();
    this.stopWait = wait;
    this.runtime.session.waitForStop({timeoutMs: 24 * 60 * 60 * 1000, pollIntervalMs: 25, signal: wait.signal})
      .then(snapshot => {
        if (this.stopWait !== wait || this.stopping) return;
        this.lastSnapshot = snapshot;
        this.sendEvent(new StoppedEvent(snapshot.state.stopReason === 'breakpoint' ? 'breakpoint' : 'step', THREAD_ID));
      })
      .catch(() => undefined)
      .finally(() => { if (this.stopWait === wait) this.stopWait = undefined; });
  }
}
