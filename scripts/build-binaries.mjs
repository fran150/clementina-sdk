import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Compiles the CLI into single-file executables that need no Node.js install.
// Run `npm run build` first; `npm run build:binaries` does both. Pass target
// names to build a subset, e.g. `node scripts/build-binaries.mjs linux-x64`.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = join(root, 'packages', 'cli', 'bin', 'clementina.mjs');
const output = join(root, 'dist', 'bin');
const targets = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'];

const requested = process.argv.slice(2);
const unknown = requested.filter(target => !targets.includes(target));
if (unknown.length) throw Error(`Unknown target ${unknown.join(', ')}; expected ${targets.join(', ')}`);

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
const sums = [];
for (const target of requested.length ? requested : targets) {
  const outfile = join(output, `clementina-${target}${target.startsWith('windows') ? '.exe' : ''}`);
  execFileSync('bun', ['build', entry, '--compile', '--minify', `--target=bun-${target}`, '--outfile', outfile], {cwd: root, stdio: 'inherit'});
  sums.push(`${createHash('sha256').update(await readFile(outfile)).digest('hex')}  ${basename(outfile)}`);
}
await writeFile(join(output, 'SHA256SUMS'), sums.join('\n') + '\n');
