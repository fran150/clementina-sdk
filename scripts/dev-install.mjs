import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Puts launchers for this checkout's `clementina` and `clementina-mcp` in the
// dev folder (dev/bin in ~/.clementina or CLEMENTINA_HOME, or CLEMENTINA_DEV_BIN). They run
// the built JavaScript in place, so `npm run build` updates them; nothing is
// copied. `npm run dev:install` builds first. See docs/dev-install.md.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bin = resolve(process.env.CLEMENTINA_DEV_BIN || join(process.env.CLEMENTINA_HOME || join(homedir(), '.clementina'), 'dev', 'bin'));
const tools = {
  'clementina': join(root, 'packages', 'cli', 'bin', 'clementina.mjs'),
  'clementina-mcp': join(root, 'packages', 'mcp', 'bin', 'clementina-mcp.mjs'),
};

await mkdir(bin, {recursive: true});
for (const [name, entry] of Object.entries(tools)) {
  if (process.platform === 'win32') {
    await writeFile(join(bin, `${name}.cmd`), `@echo off\r\nnode "${entry}" %*\r\n`);
  } else {
    const launcher = join(bin, name);
    await writeFile(launcher, `#!/bin/sh\n# Dev build from ${root}; written by npm run dev:install.\nexec node '${entry.replaceAll("'", "'\\''")}' "$@"\n`);
    await chmod(launcher, 0o755);
  }
}
console.log(`Dev launchers for ${Object.keys(tools).join(' and ')} are in ${bin}.`);
console.log('Run clementina dev on to use the dev builds in every terminal, and clementina dev off to switch back.');
