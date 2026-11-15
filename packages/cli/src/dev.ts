import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {lstat, mkdir, readdir, readlink, rm, symlink, writeFile} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {clementinaHome, currentPlatform, devBin, devModeFile, devModeOn, devTools, installedCommandPaths, readInstalled, type Platform} from './install.js';

/**
 * Dev mode makes every terminal use local builds of the SDK and its tools in
 * place of the installed releases, without replacing them. `clementina dev on`
 * writes a marker in the Clementina home folder. While it is there, the
 * installed standalone CLI hands each command to the dev build of the CLI, and
 * on macOS and Linux the `bin/` links of tools with a dev build point at it.
 * `dev` and `update` always run in the installed CLI, so a broken checkout
 * can never stop `clementina dev off`. See docs/dev-install.md.
 */

/** Set by `scripts/build-binaries.mjs` through Bun's `--define`; absent elsewhere. */
declare const CLEMENTINA_STANDALONE_VERSION: string | undefined;

/** Commands the installed CLI runs itself even in dev mode. */
const OWN_COMMANDS = new Set(['dev', 'update']);
/** Set for the dev build that the installed CLI starts, so it runs the command itself. */
const FORWARDED = 'CLEMENTINA_DEV_FORWARDED';

export class DevError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface DevStatus {
  on: boolean;
  /** The dev folder. */
  bin: string;
  /** Commands with a dev build in it. */
  tools: string[];
  /** `bin/` links changed by this call. */
  linked: string[];
}

export interface DevOptions {home?: string; env?: NodeJS.ProcessEnv; platform?: Platform}

/** Whether dev mode is on and which dev builds exist. */
export function devStatus({home = clementinaHome(), env = process.env}: DevOptions = {}): DevStatus {
  return {on: devModeOn(home), bin: devBin(home, env), tools: devTools(home, env), linked: []};
}

/** The target of a symbolic link; `null` for a regular file, `undefined` when nothing is there. */
async function linkTarget(path: string): Promise<string | null | undefined> {
  try {
    return (await lstat(path)).isSymbolicLink() ? await readlink(path) : null;
  } catch { return undefined; }
}

/** Turn dev mode on or off for every terminal. */
export async function setDevMode(on: boolean, {home = clementinaHome(), env = process.env, platform = currentPlatform()}: DevOptions = {}): Promise<DevStatus> {
  const bin = devBin(home, env);
  const tools = devTools(home, env);
  const homeBin = join(home, 'bin');
  const linked: string[] = [];
  const links = platform?.os !== 'windows';
  if (on) {
    if (!tools.length) {
      throw new DevError('dev.empty', `No dev builds in ${bin}. Run npm run dev:install in the SDK, or make dev-install in clementina-6502 or clementina-video-client, first.`);
    }
    await mkdir(join(home, 'dev'), {recursive: true});
    await writeFile(devModeFile(home), `${new Date().toISOString()}\n`);
    if (links) {
      await mkdir(homeBin, {recursive: true});
      for (const name of tools) {
        // bin/clementina is the installed CLI, which forwards to the dev build itself.
        if (name === 'clementina') continue;
        const path = join(homeBin, name);
        if (await linkTarget(path) === null) continue;
        await rm(path, {force: true});
        await symlink(join(bin, name), path);
        linked.push(name);
      }
    }
  } else {
    await rm(devModeFile(home), {force: true});
    if (links && platform) {
      const releases = installedCommandPaths(await readInstalled(home), platform);
      const inDev = resolve(bin) + sep;
      for (const name of await readdir(homeBin).catch(() => [] as string[])) {
        const path = join(homeBin, name);
        const target = await linkTarget(path);
        if (typeof target !== 'string' || !resolve(homeBin, target).startsWith(inDev)) continue;
        await rm(path, {force: true});
        const release = releases.get(name);
        if (release) await symlink(release, path);
        linked.push(name);
      }
    }
  }
  return {on, bin, tools, linked};
}

/** The one-line stderr reminder printed before each command while dev mode is on. */
export function devNotice(args: readonly string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = clementinaHome(env);
  if (env[FORWARDED] || args[0] === 'dev' || args[0] === 'mcp' || args.includes('--json') || !devModeOn(home)) return undefined;
  return `clementina: dev mode is on, using the dev builds in ${devBin(home, env)}. Run clementina dev off to use the installed tools.\n`;
}

/** A process to start in place of this one. */
export interface DevLaunch {command: string; args: string[]}

/** The dev build of the CLI that the installed standalone CLI should run instead of itself, if any. */
export function devLaunch(args: readonly string[], env: NodeJS.ProcessEnv = process.env, standalone = typeof CLEMENTINA_STANDALONE_VERSION === 'string'): DevLaunch | undefined {
  const home = clementinaHome(env);
  if (!standalone || env[FORWARDED] || OWN_COMMANDS.has(args[0]) || !devModeOn(home)) return undefined;
  const bin = devBin(home, env);
  if (process.platform === 'win32') {
    // `npm run dev:install` writes a .cmd launcher; run the node command it holds directly.
    const cmd = join(bin, 'clementina.cmd');
    const entry = existsSync(cmd) ? /node "([^"]+)"/u.exec(readFileSync(cmd, 'utf8'))?.[1] : undefined;
    if (entry) return {command: 'node', args: [entry, ...args]};
    const exe = join(bin, 'clementina.exe');
    return existsSync(exe) ? {command: exe, args: [...args]} : undefined;
  }
  const launcher = join(bin, 'clementina');
  return existsSync(launcher) ? {command: launcher, args: [...args]} : undefined;
}

/** Run the dev build with this terminal and return its exit status. */
export function runDevBuild(launch: DevLaunch, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise(done => {
    const child = spawn(launch.command, launch.args, {stdio: 'inherit', env: {...env, [FORWARDED]: '1'}});
    // The terminal sends Ctrl-C to the dev build too; it decides how to stop.
    const ignore = () => {};
    const terminate = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', ignore);
    process.on('SIGTERM', terminate);
    const finish = (status: number) => {
      process.removeListener('SIGINT', ignore);
      process.removeListener('SIGTERM', terminate);
      done(status);
    };
    child.on('error', error => {
      process.stderr.write(`clementina: could not start the dev build ${launch.command}: ${error.message}. Run clementina dev off to use the installed CLI.\n`);
      finish(1);
    });
    child.on('close', (code, signal) => finish(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
  });
}
