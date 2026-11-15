import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {delimiter, join} from 'node:path';

/**
 * `clementina install` puts the rest of the toolchain in the Clementina home
 * folder (`~/.clementina`, or `CLEMENTINA_HOME`): cc65, the emulator, the
 * video client and Studio, at their newest releases or at versions asked for.
 * The same command works on macOS, Linux and Windows. See docs/install.md.
 */

/** Tools that `clementina install` manages, in install order. */
export const INSTALLABLE_TOOLS = ['cc65', 'emulator', 'video-client', 'studio'] as const;
export type InstallableTool = typeof INSTALLABLE_TOOLS[number];

/** Where each tool is released, and the prefix of its release tags. */
export const TOOL_REPOS: Record<InstallableTool, {repo: string; tagPrefix: string}> = {
  'cc65': {repo: 'fran150/clementina-sdk', tagPrefix: 'cc65-v'},
  'emulator': {repo: 'fran150/clementina-6502', tagPrefix: 'v'},
  'video-client': {repo: 'fran150/clementina-video-client', tagPrefix: 'v'},
  'studio': {repo: 'fran150/clementina-studio', tagPrefix: 'v'},
};

/** A requested version as its release tag: `0.4.0-alpha.1` and `v0.4.0-alpha.1` both name `v0.4.0-alpha.1`; cc65 `2.19` names `cc65-v2.19`. */
export function releaseTag(tool: InstallableTool, version: string): string {
  const {tagPrefix} = TOOL_REPOS[tool];
  if (version.startsWith(tagPrefix)) return version;
  return tagPrefix + version.replace(/^v/u, '');
}

/** Executables each tool provides, relative to its folder under `tools/`. */
const COMMANDS: Record<Exclude<InstallableTool, 'studio'>, {dir: string; names: string[]}> = {
  'cc65': {dir: 'bin', names: ['ca65', 'ld65', 'ar65', 'cc65', 'cl65', 'da65', 'od65']},
  'emulator': {dir: '', names: ['clementina-emulator', 'clementina-automation']},
  'video-client': {dir: '', names: ['clementina-video-client', 'clementina-render']},
};

export interface Platform {os: 'darwin' | 'linux' | 'windows'; arch: 'amd64' | 'arm64'}

/** The release platform names for this machine, or undefined when no release is built for it. */
export function currentPlatform(platform: string = process.platform, arch: string = process.arch): Platform | undefined {
  const os = ({darwin: 'darwin', linux: 'linux', win32: 'windows'} as Record<string, Platform['os']>)[platform];
  const cpu = ({x64: 'amd64', arm64: 'arm64'} as Record<string, Platform['arch']>)[arch];
  if (!os || !cpu || (os === 'windows' && cpu === 'arm64')) return undefined;
  return {os, arch: cpu};
}

/** The release file for a tool on a platform, or undefined when that tool has no build for it. */
export function assetName(tool: InstallableTool, platform: Platform, tag: string): string | undefined {
  const archive = platform.os === 'windows' ? 'zip' : 'tar.gz';
  const target = `${platform.os}-${platform.arch}`;
  switch (tool) {
    case 'cc65': return `cc65-${tag.replace(/^cc65-v/u, '')}-${target}.${archive}`;
    case 'emulator': return `clementina-emulator-${tag}-${target}.${archive}`;
    case 'video-client': return `clementina-video-client-${tag}-${target}.${archive}`;
    case 'studio': {
      const version = tag.replace(/^v/u, '');
      if (platform.os === 'darwin') return `clementina-studio-${version}-mac-${platform.arch === 'arm64' ? 'arm64' : 'x64'}.zip`;
      if (platform.arch !== 'amd64') return undefined;
      return platform.os === 'linux' ? `clementina-studio-${version}-linux-x86_64.AppImage` : `clementina-studio-${version}-win-x64.exe`;
    }
  }
}

/** The Clementina home folder: `CLEMENTINA_HOME`, or `.clementina` in the user's home. */
export function clementinaHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLEMENTINA_HOME || join(homedir(), '.clementina');
}

/** Folders holding installed executables, which commands search before PATH. */
export function installedToolDirectories(home = clementinaHome()): string[] {
  return [join(home, 'bin'), ...Object.entries(COMMANDS).map(([tool, {dir}]) => join(home, 'tools', tool, dir))];
}

/**
 * Add the installed tools to the end of this process's PATH, so builds, runs
 * and checks find them in a shell that has not picked up the PATH change yet.
 * They go last so the shell's own order still wins, including dev builds that
 * `clementina-dev on` puts first.
 */
export function useInstalledTools(env: NodeJS.ProcessEnv = process.env): void {
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  const current = (env[key] ?? '').split(delimiter).filter(Boolean);
  const added = installedToolDirectories(clementinaHome(env)).filter(dir => !current.includes(dir));
  env[key] = [...current, ...added].join(delimiter);
}

/** One tool to install, at its newest release unless a version is given. */
export interface ToolRequest {tool: InstallableTool; version?: string}

export interface InstallOptions {
  tools: readonly ToolRequest[];
  /** Leave shell startup files and the Windows user PATH alone. */
  modifyPath: boolean;
  /** Download again even when that release is already installed. */
  force?: boolean;
  home?: string;
  platform?: Platform;
  /** Release download root; tests serve a local copy. */
  downloadBase?: string;
  /** GitHub API root used to find the newest releases. */
  apiBase?: string;
  fetcher?: typeof fetch;
  report?: (line: string) => void;
}

export interface InstalledTool {tool: InstallableTool; tag: string; asset: string; location: string; commands: string[]}

export interface InstallReport {home: string; installed: InstalledTool[]; current: InstalledTool[]; skipped: {tool: InstallableTool; reason: string}[]; path: PathChange}

export type PathChange = {changed: false; reason: string} | {changed: true; files: string[]};

export class InstallError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'InstallError'; }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

/** The newest release tag of a tool, prereleases included. */
async function latestTag(tool: InstallableTool, api: string, base: string, fetcher: typeof fetch): Promise<string> {
  const {repo, tagPrefix} = TOOL_REPOS[tool];
  return latestReleaseTag(repo, tagPrefix, tool, api, base, fetcher);
}

/** The newest release of a repository whose tag starts with a prefix and a digit. */
async function latestReleaseTag(repo: string, tagPrefix: string, label: string, api: string, base: string, fetcher: typeof fetch): Promise<string> {
  // cc65-v* and v* tags share the SDK repository, so the prefix must be followed by a digit.
  const matches = (tag: string) => tag.startsWith(tagPrefix) && /^\d/u.test(tag.slice(tagPrefix.length));
  let tags: string[];
  try {
    const token = process.env.GITHUB_TOKEN;
    const body = await download(`${api}/repos/${repo}/releases?per_page=50`, fetcher,
      {accept: 'application/vnd.github+json', ...(token ? {authorization: `Bearer ${token}`} : {})});
    const releases = JSON.parse(body.toString('utf8')) as {tag_name: string; draft?: boolean}[];
    tags = releases.filter(entry => !entry.draft).map(entry => entry.tag_name);
  } catch (error) {
    // The API allows 60 requests an hour per address without a token; the
    // releases feed has no such limit and lists the same releases, newest first.
    if (!(error instanceof InstallError) || error.code === 'install.release') throw error;
    const feed = (await download(`${base}/${repo}/releases.atom`, fetcher)).toString('utf8');
    tags = [...feed.matchAll(/\/releases\/tag\/([^"<>\s]+)/gu)].map(match => decodeURIComponent(match[1]));
  }
  const tag = tags.find(matches);
  if (!tag) throw new InstallError('install.release', `${repo} has no ${label} release yet`);
  return tag;
}

async function download(url: string, fetcher: typeof fetch, headers: Record<string, string> = {}): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(url, {redirect: 'follow', headers: {'user-agent': 'clementina-install', ...headers}});
  } catch (error) {
    throw new InstallError('install.download', `Could not download ${url}: ${(error as Error).message}`);
  }
  if (response.status === 404) throw new InstallError('install.release', `Not found: ${url}. Check the tool name and version.`);
  if (!response.ok) throw new InstallError('install.download', `Could not download ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function run(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', windowsHide: true});
  if (result.error || result.status !== 0) {
    throw new InstallError('install.extract', `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

/** Unpack an archive into a new folder and return the folder that holds its files, or `into` itself without `strip`. */
async function unpack(archive: string, into: string, strip = true): Promise<string> {
  await mkdir(into, {recursive: true});
  // tar reads .tar.gz everywhere, and .zip on macOS and Windows (bsdtar). On
  // Windows, use the system's bsdtar: a GNU tar from Git or MSYS2 earlier on
  // PATH reads `C:` in a path as a remote host and cannot open zip files.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  run(tar, ['-xof', archive, '-C', into]);
  const entries = await readdir(into, {withFileTypes: true});
  return strip && entries.length === 1 && entries[0].isDirectory() ? join(into, entries[0].name) : into;
}

/** Replace `target` with `source`, keeping the old copy until the new one is in place. */
async function replaceDirectory(source: string, target: string): Promise<void> {
  const old = `${target}.old`;
  await rm(old, {recursive: true, force: true});
  try { await rename(target, old); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new InstallError('install.busy', `Could not replace ${target}; close any program running from it and try again (${(error as Error).message})`);
    }
  }
  await rename(source, target);
  await rm(old, {recursive: true, force: true});
}

/** Point `bin/<name>` at an installed executable. Windows uses the tool folders on PATH instead. */
async function link(bin: string, name: string, target: string, platform: Platform): Promise<void> {
  if (platform.os === 'windows') return;
  const launcher = join(bin, name);
  await rm(launcher, {force: true});
  await symlink(target, launcher);
}

async function installStudio(file: string, platform: Platform, home: string, bin: string): Promise<string> {
  const tools = join(home, 'tools');
  if (platform.os === 'windows') {
    // The NSIS installer installs for this user only; /S skips its window.
    run(file, ['/S']);
    return 'the Start menu (Clementina Studio)';
  }
  if (platform.os === 'linux') {
    const dir = join(tools, 'studio');
    await mkdir(dir, {recursive: true});
    const image = join(dir, 'clementina-studio.AppImage');
    await rm(image, {force: true});
    await rename(file, image);
    await chmod(image, 0o755);
    await link(bin, 'clementina-studio', image, platform);
    const applications = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications');
    await mkdir(applications, {recursive: true});
    await writeFile(join(applications, 'clementina-studio.desktop'),
      `[Desktop Entry]\nType=Application\nName=Clementina Studio\nExec="${image}" %U\nCategories=Development;\n`);
    return image;
  }
  // macOS: the zip holds the .app bundle; it goes in the user's Applications folder.
  // The zip's only top-level entry is the bundle itself, so keep it.
  const unpacked = await unpack(file, await mkdtemp(join(tools, '.studio-')), false);
  const app = (await readdir(unpacked)).find(name => name.endsWith('.app'));
  if (!app) throw new InstallError('install.extract', 'The Studio download holds no .app bundle');
  const applications = join(homedir(), 'Applications');
  await mkdir(applications, {recursive: true});
  const target = join(applications, app);
  await replaceDirectory(join(unpacked, app), target);
  await rm(unpacked, {recursive: true, force: true});
  // The app is not notarized during the alpha; clear the download quarantine so it opens.
  spawnSync('xattr', ['-dr', 'com.apple.quarantine', target]);
  return target;
}

const PATH_MARKER = '# Added by clementina install';

/** Make new shells find the installed tools. */
async function addToUserPath(home: string, platform: Platform): Promise<PathChange> {
  if (platform.os === 'windows') {
    const dirs = installedToolDirectories(home);
    const script = `$dirs = @(${dirs.map(dir => `'${dir.replaceAll("'", "''")}'`).join(',')});`
      + `$path = [Environment]::GetEnvironmentVariable('Path', 'User'); $parts = @($path -split ';' | Where-Object { $_ });`
      + `$missing = @($dirs | Where-Object { $parts -notcontains $_ });`
      + `if ($missing.Count) { [Environment]::SetEnvironmentVariable('Path', (($missing + $parts) -join ';'), 'User'); 'changed' }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {encoding: 'utf8', windowsHide: true});
    if (result.status !== 0) throw new InstallError('install.path', `Could not update the user PATH: ${result.stderr.trim()}`);
    return result.stdout.includes('changed') ? {changed: true, files: ['user Path']} : {changed: false, reason: 'already on the user PATH'};
  }
  const bin = join(home, 'bin');
  const line = `export PATH="${bin.startsWith(homedir()) ? `$HOME${bin.slice(homedir().length)}` : bin}:$PATH" ${PATH_MARKER}`;
  const shell = process.env.SHELL ?? '';
  const files = shell.endsWith('zsh') ? ['.zshrc'] : shell.endsWith('bash') ? ['.bashrc', platform.os === 'darwin' ? '.bash_profile' : '.profile'] : ['.profile'];
  const changed: string[] = [];
  for (const name of files) {
    const file = join(homedir(), name);
    const content = await readFile(file, 'utf8').catch(() => '');
    if (content.includes(PATH_MARKER)) continue;
    await writeFile(file, `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`);
    changed.push(file);
  }
  return changed.length ? {changed: true, files: changed} : {changed: false, reason: 'shell startup files already set'};
}

/** Download, verify and unpack the requested tools into the Clementina home folder. */
export async function installTools(options: InstallOptions): Promise<InstallReport> {
  const platform = options.platform ?? currentPlatform();
  if (!platform) throw new InstallError('install.platform', `No Clementina release is built for ${process.platform} ${process.arch}`);
  const home = options.home ?? clementinaHome();
  const fetcher = options.fetcher ?? fetch;
  const base = (options.downloadBase ?? process.env.CLEMENTINA_DOWNLOAD_BASE ?? 'https://github.com').replace(/\/$/u, '');
  const api = (options.apiBase ?? process.env.CLEMENTINA_API_BASE ?? 'https://api.github.com').replace(/\/$/u, '');
  const report = options.report ?? (() => {});
  const bin = join(home, 'bin');
  const tools = join(home, 'tools');
  await mkdir(bin, {recursive: true});
  await mkdir(tools, {recursive: true});
  const installed: InstalledTool[] = [];
  const current: InstalledTool[] = [];
  const skipped: InstallReport['skipped'] = [];
  const previous = await readInstalled(home);
  for (const {tool, version} of options.tools) {
    const {repo} = TOOL_REPOS[tool];
    const tag = version ? releaseTag(tool, version) : await latestTag(tool, api, base, fetcher);
    const asset = assetName(tool, platform, tag);
    const existing = previous.find(entry => entry.tool === tool && entry.tag === tag);
    if (existing && !options.force && (tool === 'studio' && platform.os === 'windows' || await exists(existing.location))) {
      current.push(existing);
      report(`${tool}: ${tag} is already installed`);
      continue;
    }
    if (!asset) {
      skipped.push({tool, reason: `no ${tool} build for ${platform.os}-${platform.arch}`});
      report(`${tool}: skipped, no build for ${platform.os}-${platform.arch}`);
      continue;
    }
    const release = `${base}/${repo}/releases/download/${tag}`;
    report(`${tool}: downloading ${asset} (${tag})`);
    const sums = (await download(`${release}/SHA256SUMS`, fetcher)).toString('utf8');
    const expected = sums.split(/\r?\n/u).map(row => row.trim().split(/\s+\*?/u)).find(([, name]) => name === asset)?.[0];
    if (!expected) throw new InstallError('install.checksum', `${tag} SHA256SUMS lists no ${asset}`);
    const data = await download(`${release}/${asset}`, fetcher);
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== expected.toLowerCase()) throw new InstallError('install.checksum', `${asset} does not match its SHA256SUMS entry`);
    const work = await mkdtemp(join(tools, `.${tool}-`));
    try {
      const file = join(work, asset);
      await writeFile(file, data);
      let location: string;
      let commands: string[] = [];
      if (tool === 'studio') {
        location = await installStudio(file, platform, home, bin);
        if (platform.os === 'linux') commands = ['clementina-studio'];
      } else {
        location = join(tools, tool);
        await replaceDirectory(await unpack(file, join(work, 'unpacked')), location);
        const {dir, names} = COMMANDS[tool];
        const ext = platform.os === 'windows' ? '.exe' : '';
        const present = new Set(await readdir(join(location, dir)));
        commands = names.filter(name => present.has(name + ext));
        for (const name of commands) await link(bin, name, join(location, dir, name + ext), platform);
      }
      installed.push({tool, tag, asset, location, commands});
      report(`${tool}: installed ${tag} in ${location}`);
    } finally {
      await rm(work, {recursive: true, force: true});
    }
  }
  await writeFile(join(home, 'installed.json'), JSON.stringify({version: 1, platform, tools: Object.fromEntries(
    [...previous.map(entry => [entry.tool, entry] as const), ...installed.map(entry => [entry.tool, entry] as const)])}, null, 2) + '\n');
  const path = options.modifyPath ? await addToUserPath(home, platform) : {changed: false as const, reason: '--no-modify-path'};
  return {home, installed, current, skipped, path};
}

/** Tools recorded by earlier installs into this home folder. */
export async function readInstalled(home = clementinaHome()): Promise<InstalledTool[]> {
  try {
    const parsed = JSON.parse(await readFile(join(home, 'installed.json'), 'utf8')) as {tools?: Record<string, InstalledTool>};
    return Object.values(parsed.tools ?? {});
  } catch { return []; }
}

/** Where the SDK's own command-line tool is released. */
const CLI_REPO = 'fran150/clementina-sdk';

/** The standalone CLI's release file for a platform. */
export function cliAssetName(platform: Platform): string {
  const arch = platform.arch === 'amd64' ? 'x64' : 'arm64';
  return `clementina-${platform.os}-${arch}${platform.os === 'windows' ? '.exe' : ''}`;
}

export interface UpdateOptions {
  /** Only report what has a newer release; download nothing. */
  check: boolean;
  /** Tools to update; default every installed tool. */
  tools?: readonly InstallableTool[];
  home?: string;
  platform?: Platform;
  downloadBase?: string;
  apiBase?: string;
  fetcher?: typeof fetch;
  report?: (line: string) => void;
  /** The running CLI: its version, and the executable when it is a standalone release. */
  cli: {version: string; executable?: string; how: 'standalone' | 'package' | 'dev'};
}

export interface UpdateReport {
  cli: {current: string; latest: string; updated: boolean; hint?: string};
  tools: {tool: InstallableTool; current: string; latest: string}[];
  installed: InstalledTool[];
}

/** Bring the CLI and the installed tools to their newest releases, or report which have one. */
export async function updateTools(options: UpdateOptions): Promise<UpdateReport> {
  const platform = options.platform ?? currentPlatform();
  if (!platform) throw new InstallError('install.platform', `No Clementina release is built for ${process.platform} ${process.arch}`);
  const home = options.home ?? clementinaHome();
  const fetcher = options.fetcher ?? fetch;
  const base = (options.downloadBase ?? process.env.CLEMENTINA_DOWNLOAD_BASE ?? 'https://github.com').replace(/\/$/u, '');
  const api = (options.apiBase ?? process.env.CLEMENTINA_API_BASE ?? 'https://api.github.com').replace(/\/$/u, '');
  const report = options.report ?? (() => {});

  // The CLI first: a newer CLI may know about newer tools.
  const current = `v${options.cli.version.replace(/^v/u, '')}`;
  const latest = await latestReleaseTag(CLI_REPO, 'v', 'SDK', api, base, fetcher);
  const cli: UpdateReport['cli'] = {current, latest, updated: false};
  if (latest !== current) {
    if (options.cli.how !== 'standalone' || !options.cli.executable) {
      cli.hint = options.cli.how === 'dev' ? 'this is a dev build, so update its checkout'
        : 'run the install script to get the standalone CLI';
      report(`clementina: ${latest} is available (running ${current}); ${cli.hint}`);
    } else if (options.check) {
      report(`clementina: ${latest} is available (running ${current})`);
    } else {
      report(`clementina: downloading ${latest}`);
      await replaceCli(options.cli.executable, `${base}/${CLI_REPO}/releases/download/${latest}`, cliAssetName(platform), platform, fetcher);
      cli.updated = true;
      report(`clementina: updated to ${latest}`);
    }
  } else {
    report(`clementina: ${current} is the newest release`);
  }

  const recorded = await readInstalled(home);
  const names = options.tools ?? INSTALLABLE_TOOLS.filter(tool => recorded.some(entry => entry.tool === tool));
  const tools: UpdateReport['tools'] = [];
  for (const tool of names) {
    const newest = await latestTag(tool, api, base, fetcher);
    const was = recorded.find(entry => entry.tool === tool)?.tag ?? 'not installed';
    if (newest === was) {
      report(`${tool}: ${was} is the newest release`);
      continue;
    }
    tools.push({tool, current: was, latest: newest});
    if (options.check) report(`${tool}: ${newest} is available (installed: ${was})`);
  }
  const installed = options.check || !tools.length ? [] : (await installTools({
    tools: tools.map(({tool, latest: version}) => ({tool, version})), modifyPath: false, home, platform,
    downloadBase: base, apiBase: api, fetcher, report,
  })).installed;
  return {cli, tools, installed};
}

/** Replace the running standalone executable with a release's, after checking SHA256SUMS. */
async function replaceCli(executable: string, release: string, asset: string, platform: Platform, fetcher: typeof fetch): Promise<void> {
  const sums = (await download(`${release}/SHA256SUMS`, fetcher)).toString('utf8');
  const expected = sums.split(/\r?\n/u).map(row => row.trim().split(/\s+\*?/u)).find(([, name]) => name === asset)?.[0];
  if (!expected) throw new InstallError('install.checksum', `${release} SHA256SUMS lists no ${asset}`);
  const data = await download(`${release}/${asset}`, fetcher);
  if (createHash('sha256').update(data).digest('hex') !== expected.toLowerCase()) {
    throw new InstallError('install.checksum', `${asset} does not match its SHA256SUMS entry`);
  }
  const next = `${executable}.new`;
  await writeFile(next, data);
  await chmod(next, 0o755);
  if (platform.os === 'windows') {
    // Windows will not overwrite a running executable, but it will rename one.
    const old = `${executable}.old`;
    await rm(old, {force: true}).catch(() => {});
    await rename(executable, old);
  }
  await rename(next, executable);
}
