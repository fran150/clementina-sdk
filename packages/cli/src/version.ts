import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** Set by `scripts/build-binaries.mjs` through Bun's `--define`; absent elsewhere. */
declare const CLEMENTINA_STANDALONE_VERSION: string | undefined;

/** Which copy of the CLI is running, so a dev build is never mistaken for a release. */
export interface CliVersion {
  version: string;
  /** `standalone`: a release executable; `checkout`: a build in an SDK clone; `package`: installed from npm. */
  source: 'standalone' | 'checkout' | 'package';
  commit?: string;
  dirty?: boolean;
  checkout?: string;
}

function git(root: string, args: string[]): string | undefined {
  const result = spawnSync('git', ['-C', root, ...args], {encoding: 'utf8', timeout: 5000, windowsHide: true});
  return result.status === 0 ? result.stdout.trim() : undefined;
}

let cached: CliVersion | undefined;

/** Read the CLI's version and, for a build in an SDK checkout, its commit. */
export function cliVersion(): CliVersion {
  if (cached) return cached;
  if (typeof CLEMENTINA_STANDALONE_VERSION === 'string') return cached = {version: CLEMENTINA_STANDALONE_VERSION, source: 'standalone'};
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version: string};
  // dist/version.js sits in packages/cli/dist of a checkout; an npm install has no .git above it.
  const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/u, '');
  const commit = existsSync(`${root}/.git`) ? git(root, ['rev-parse', '--short', 'HEAD']) : undefined;
  if (!commit) return cached = {version: manifest.version, source: 'package'};
  const dirty = Boolean(git(root, ['status', '--porcelain', '--untracked-files=no']));
  return cached = {version: manifest.version, source: 'checkout', commit, dirty, checkout: root};
}

/** One line such as `clementina 0.3.0-alpha.1 (dev build, commit abc1234, /src/clementina-sdk)`. */
export function formatCliVersion(version = cliVersion()): string {
  if (version.source === 'standalone') return `clementina ${version.version}`;
  if (version.source === 'package') return `clementina ${version.version} (npm package)`;
  return `clementina ${version.version} (dev build, commit ${version.commit}${version.dirty ? ' with local changes' : ''}, ${version.checkout})`;
}
