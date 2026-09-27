import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspaceRoot = join(root, 'packages');
const names = (await readdir(workspaceRoot, {withFileTypes: true}))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const packages = await Promise.all(names.map(async directory => ({
  directory, manifest: JSON.parse(await readFile(join(workspaceRoot, directory, 'package.json'), 'utf8')),
})));
const byName = new Map(packages.map(pkg => [pkg.manifest.name, pkg]));
const errors = [];
const cache = await mkdtemp(join(tmpdir(), 'clementina-pack-check-'));
const license = await readFile(join(root, 'LICENSE'));

function targets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(targets);
  return [];
}

try {
  for (const {directory, manifest} of packages) {
    if (!manifest.name || !manifest.version) errors.push(`${directory}: missing name or version`);
    if (manifest.license !== 'GPL-3.0-only') errors.push(`${directory}: license must match the repository GPLv3 license`);
    if (directory !== 'vscode-extension' && (manifest.private === true || manifest.publishConfig?.access !== 'public')) {
      errors.push(`${directory}: SDK npm package is not configured for public publication`);
    }
    const packageLicense = await readFile(join(workspaceRoot, directory, 'LICENSE'));
    if (!packageLicense.equals(license)) errors.push(`${directory}: LICENSE differs from the repository copy`);
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) errors.push(`${directory}: missing files allowlist`);
    for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
      if (dependency.startsWith('@clementina/') && !byName.has(dependency)) errors.push(`${directory}: unknown workspace dependency ${dependency}`);
      if (dependency.startsWith('@clementina/') && version !== manifest.version) errors.push(`${directory}: ${dependency} version ${version} differs from ${manifest.version}`);
    }
    const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts', '--workspace', manifest.name], {
        cwd: root, encoding: 'utf8', env: {...process.env, npm_config_cache: cache},
      });
    const packed = JSON.parse(output)[0];
    const files = new Set(packed.files.map(file => file.path));
    const entrypoints = [manifest.main, manifest.types, ...targets(manifest.exports), ...Object.values(manifest.bin ?? {})]
      .filter(Boolean).map(path => path.replace(/^\.\//u, ''));
    for (const entrypoint of entrypoints) {
      if (!files.has(entrypoint)) errors.push(`${directory}: ${entrypoint} is absent from the npm package`);
    }
    if (!files.has('package.json')) errors.push(`${directory}: package.json is absent from the npm package`);
    if (!files.has('LICENSE')) errors.push(`${directory}: LICENSE is absent from the npm package`);
    if (directory === 'runtime' && !files.has('asm/runtime.inc')) errors.push(`${directory}: runtime assembly sources are absent`);
    if (directory === 'vscode-extension') {
      for (const path of ['language-configuration.json', 'syntaxes/clementina-basic.tmLanguage.json']) {
        if (!files.has(path)) errors.push(`${directory}: ${path} is absent`);
      }
    }
    console.log(`${manifest.name}: ${files.size} packaged files`);
  }
} finally {
  await rm(cache, {recursive: true, force: true});
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else console.log('Package contents and workspace versions: OK');
