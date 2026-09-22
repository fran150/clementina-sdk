import {spawn, type ChildProcess} from 'node:child_process';
import {realpath, stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout} from 'node:timers';
import {createHttpEmulatorClient, type EmulatorClient} from './index.js';

export class EmulatorProcessError extends Error {
  constructor(message: string) { super(message); this.name = 'EmulatorProcessError'; }
}

export interface EmulatorProcessOptions {
  /** Headless Go automation executable; defaults to PATH lookup. */
  executable?: string;
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
  close(): Promise<EmulatorProcessExit>;
}

const STDERR_LIMIT = 16 * 1024;

function endpointFromLine(line: string): string {
  let url: URL;
  try { url = new URL(line.trim()); }
  catch { throw new EmulatorProcessError('Emulator printed an invalid automation endpoint'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1' || url.search || url.hash || !url.port) {
    throw new EmulatorProcessError('Emulator endpoint must be http://127.0.0.1:<port>/v1');
  }
  return url.href;
}

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

/** Start one owned Go automation process and verify its advertised HTTP protocol. */
export async function startEmulatorProcess(options: EmulatorProcessOptions): Promise<EmulatorProcess> {
  const executable = options.executable ?? 'clementina-automation';
  if (!executable || /[\u0000\r\n]/u.test(executable)) throw new TypeError('Invalid emulator executable');
  const info = await stat(options.sdRoot);
  if (!info.isDirectory()) throw new TypeError('sdRoot must be an existing directory');
  const sdRoot = await realpath(options.sdRoot);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be 0..65535');
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120_000) throw new RangeError('startupTimeoutMs must be 1..120000');

  const child = spawn(executable, ['-sd', sdRoot, '-port', String(port)], {
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
    const firstLine = new Promise<string>((resolveLine, reject) => {
      lines.once('line', resolveLine);
      child.once('error', reject);
      child.once('exit', (code, signal) => reject(new EmulatorProcessError(`Emulator exited before readiness (${code ?? signal ?? 'unknown'})${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));
    });
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
    const detail = spawnError?.message ?? (error instanceof Error ? error.message : String(error));
    throw error instanceof EmulatorProcessError ? error : new EmulatorProcessError(detail);
  }
}
