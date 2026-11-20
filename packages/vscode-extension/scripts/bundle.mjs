import {build} from 'esbuild';
import {copyFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Bundles the extension and the three SDK servers it spawns into dist/, so the
// .vsix carries no node_modules (vsce cannot collect dependencies from an npm
// workspace). Run after `tsc -b` has built the server packages.
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const bin = (name, file) => join(dirname(require.resolve(`${name}/package.json`)), 'bin', file);
const options = {absWorkingDir: root, bundle: true, minify: true, platform: 'node', target: 'node20', logLevel: 'warning'};

// The YAML extension checks clementina.yaml against the SDK's project schema.
await mkdir(join(root, 'dist'), {recursive: true});
await copyFile(join(root, '../../specs/schema/project.schema.json'), join(root, 'dist/project.schema.json'));

await Promise.all([
  build({...options, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', format: 'cjs', external: ['vscode']}),
  // The servers stay ESM like the SDK packages; their CommonJS dependencies
  // still need a real require() to load Node built-ins.
  build({
    ...options,
    entryPoints: {
      'debug-adapter': bin('@clementina/debug-adapter', 'clementina-debug-adapter.mjs'),
      'basic-lsp': bin('@clementina/basic-lsp', 'clementina-basic-lsp.mjs'),
      'asm-lsp': bin('@clementina/asm-lsp', 'clementina-asm-lsp.mjs'),
    },
    outdir: 'dist',
    outExtension: {'.js': '.mjs'},
    format: 'esm',
    banner: {js: "import {createRequire as __createRequire} from 'node:module'; const require = __createRequire(import.meta.url);"},
  }),
]);
