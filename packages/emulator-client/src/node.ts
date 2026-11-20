import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout} from 'node:timers';
import {errorMessage} from '@clementina/core';
import {createHttpEmulatorClient, type EmulatorClient} from './index.js';

/** Automation executable started when no path is configured. */
export const DEFAULT_EMULATOR_EXECUTABLE = 'clementina-automation';

/** Real-time emulator started by debuggers that let a person play the game. */
export const DEFAULT_REALTIME_EMULATOR_EXECUTABLE = 'clementina-emulator';

/** Window that shows the emulator's video and sends it keyboard and gamepad input. */
export const DEFAULT_VIDEO_CLIENT_EXECUTABLE = 'clementina-video-client';

/** Environment variable that tools read to locate the automation executable. */
export const EMULATOR_EXECUTABLE_ENV = 'CLEMENTINA_EMULATOR';

/**
 * Find a tool that `clementina install` puts in the Clementina home's bin
 * folder (`CLEMENTINA_HOME`, or `~/.clementina`). An editor started from the
 * Dock or Start menu may not have that folder on PATH, so it is checked first.
 * @returns The installed file when it exists, otherwise the bare name for PATH lookup.
 */
export function findInstalledTool(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const home = env.CLEMENTINA_HOME || join(homedir(), '.clementina');
  const installed = join(home, 'bin', platform === 'win32' ? `${name}.exe` : name);
  return existsSync(installed) ? installed : name;
}

/**
 * Choose the automation executable for a command-line or MCP host.
 * @param explicit - Path supplied by the caller, which takes precedence.
 * @param env - Environment to read `CLEMENTINA_EMULATOR` from.
 * @returns The explicit path, the environment override, or the installed default.
 */
export function resolveEmulatorExecutable(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  return explicit ?? env[EMULATOR_EXECUTABLE_ENV] ?? findInstalledTool(DEFAULT_EMULATOR_EXECUTABLE, env);
}

export class EmulatorProcessError extends Error {
  /** Create an error for process startup or readiness failures. */
  constructor(message: string) { super(message); this.name = 'EmulatorProcessError'; }
}

/**
 * Run the real-time emulator (`clementina-emulator --headless --control`)
 * instead of the unthrottled automation server. It keeps PHI2 time, serves
 * video and input over UDP for the video client, and answers the same API.
 */
export interface RealtimeEmulatorOptions {
  /** PHI2 target in MHz; 0 runs unthrottled. Omitted, the emulator's default (1.2 MHz). */
  speedMhz?: number;
  /** UDP address for video; omitted uses the emulator default the video client expects. */
  videoUdp?: string;
  /** UDP address for input; omitted uses the emulator default. */
  inputUdp?: string;
}

export interface EmulatorProcessOptions {
  /** Emulator executable; defaults to the installed tool, then PATH lookup. */
  executable?: string;
  /** Start the real-time emulator rather than the automation server. */
  realtime?: RealtimeEmulatorOptions;
  /** Existing host directory mounted as the emulator SD root. */
  sdRoot: string;
  /** Optional fixed loopback port. Zero or omission lets the OS choose. */
  port?: number;
  startupTimeoutMs?: number;
  /** Optional caller-owned fetch implementation, useful for policy and tests. */
  fetcher?: typeof fetch;
  /** Receives emulator stderr while also retaining a bounded diagnostic tail. */
  onStderr?: (text: string) => void;
}

export interface EmulatorProcessExit {code: number | null; signal: NodeJS.Signals | null}
export interface EmulatorProcess {
  endpoint: string;
  client: EmulatorClient;
  pid: number;
  exited: Promise<EmulatorProcessExit>;
  /** Terminate the owned process once and return its exit status. */
  close(): Promise<EmulatorProcessExit>;
}

const STDERR_LIMIT = 16 * 1024;

/** Require the loopback endpoint printed by the headless automation command. */
function endpointFromLine(line: string): string {
  let url: URL;
  try { url = new URL(line.trim()); }
  catch { throw new EmulatorProcessError('Emulator printed an invalid automation endpoint'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1' || url.search || url.hash || !url.port) {
    throw new EmulatorProcessError('Emulator endpoint must be http://127.0.0.1:<port>/v1');
  }
  return url.href;
}

/** Read the first stdout line, stopping if the child fails or exits first. */
function firstEndpointLine(child: ChildProcess, lines: ReturnType<typeof createInterface>, stderr: () => string): Promise<string> {
  return new Promise((resolve, reject) => {
    /** Detach listeners after the first startup outcome. */
    function cleanup(): void {
      lines.off('line', onLine);
      child.off('error', onError);
      child.off('exit', onExit);
    }
    /** Accept the first printed endpoint candidate. */
    function onLine(line: string): void { cleanup(); resolve(line); }
    /** Report a process spawn error before readiness. */
    function onError(error: Error): void { cleanup(); reject(error); }
    /** Report a process exit before an endpoint is printed. */
    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      cleanup();
      const detail = stderr().trim();
      reject(new EmulatorProcessError(`Emulator exited before readiness (${code ?? signal ?? 'unknown'})${detail ? `: ${detail}` : ''}`));
    }
    lines.once('line', onLine);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/** Ask the child to stop, then force termination after the grace period. */
async function terminate(child: ChildProcess, exited: Promise<EmulatorProcessExit>): Promise<EmulatorProcessExit> {
  if (child.exitCode !== null || child.signalCode !== null) return exited;
  child.kill('SIGTERM');
  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<undefined>(resolve => { timer = setNodeTimeout(() => resolve(undefined), 2000); });
  const stopped = await Promise.race([exited, grace]);
  if (timer) clearNodeTimeout(timer);
  if (stopped) return stopped;
  child.kill('SIGKILL');
  return exited;
}

/** Command line for a paused, headless real-time emulator with its control API. */
function realtimeArguments(options: RealtimeEmulatorOptions, sdRoot: string, port: number): string[] {
  const args = ['--headless', '--control', '--paused', '--sd', sdRoot, '--control-port', String(port)];
  if (options.speedMhz !== undefined) {
    if (!Number.isFinite(options.speedMhz) || options.speedMhz < 0 || options.speedMhz > 100) throw new RangeError('speedMhz must be 0..100');
    args.push('--speed', String(options.speedMhz));
  }
  for (const [flag, value] of [['--video-udp', options.videoUdp], ['--input-udp', options.inputUdp]] as const) {
    if (value === undefined) continue;
    if (/[\u0000\r\n]/u.test(value)) throw new TypeError(`Invalid ${flag} address`);
    args.push(flag, value);
  }
  return args;
}

/** Start one owned Go automation process and verify its advertised HTTP protocol. */
export async function startEmulatorProcess(options: EmulatorProcessOptions): Promise<EmulatorProcess> {
  const executable = options.executable
    ?? findInstalledTool(options.realtime ? DEFAULT_REALTIME_EMULATOR_EXECUTABLE : DEFAULT_EMULATOR_EXECUTABLE);
  if (!executable || /[\u0000\r\n]/u.test(executable)) throw new TypeError('Invalid emulator executable');
  const info = await stat(options.sdRoot);
  if (!info.isDirectory()) throw new TypeError('sdRoot must be an existing directory');
  const sdRoot = await realpath(options.sdRoot);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be 0..65535');
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120_000) throw new RangeError('startupTimeoutMs must be 1..120000');

  const args = options.realtime ? realtimeArguments(options.realtime, sdRoot, port) : ['-sd', sdRoot, '-port', String(port)];
  const child = spawn(executable, args, {
    cwd: sdRoot, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '', spawnError: Error | undefined;
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    options.onStderr?.(chunk);
  });
  const exited = new Promise<EmulatorProcessExit>(resolve => child.once('close', (code, signal) => resolve({code, signal})));
  child.once('error', error => { spawnError = error; });
  const lines = createInterface({input: child.stdout});

  let timer: NodeJS.Timeout | undefined;
  try {
    const firstLine = firstEndpointLine(child, lines, () => stderr);
    const timeout = new Promise<never>((_, reject) => {
      timer = setNodeTimeout(() => reject(new EmulatorProcessError(`Emulator readiness timed out after ${startupTimeoutMs} ms`)), startupTimeoutMs);
    });
    const endpoint = endpointFromLine(await Promise.race([firstLine, timeout]));
    lines.close();
    const client = createHttpEmulatorClient(endpoint, options.fetcher);
    await Promise.race([client.capabilities(), timeout]);
    if (timer) clearNodeTimeout(timer);
    let closing: Promise<EmulatorProcessExit> | undefined;
    return {
      endpoint, client, pid: child.pid!, exited,
      close: () => closing ??= terminate(child, exited),
    };
  } catch (error) {
    if (timer) clearNodeTimeout(timer);
    lines.close();
    await terminate(child, exited).catch(() => undefined);
    const detail = spawnError?.message ?? errorMessage(error);
    throw error instanceof EmulatorProcessError ? error : new EmulatorProcessError(detail);
  }
}
