import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {checkAsset, type AssetKind} from '@clementina/assets';
import {loadProject} from '@clementina/project/node';
import type {ClementinaDiagnostic} from '@clementina/core';

export interface CommandResult {ok: boolean; diagnostics: ClementinaDiagnostic[]; exitCode: number; message?: string}
const failure = (code: string, message: string, exitCode = 1, source?: string): CommandResult => ({ok: false, diagnostics: [{severity: 'error', code, message, ...(source ? {source} : {})}], exitCode});
export const help = `Usage: clementina <command> [--json]
  project validate [directory]   Validate manifest, assets, references, and sources
  asset validate <file>          Validate any portable asset
  sprite validate <file>         Validate a portable shape (one or more sprites)
  animation validate <file>      Validate a portable animation
  doctor                        Check the SDK runtime

Exit codes: 0 success, 1 validation/I/O failure, 2 invalid command.
Standalone assets are checked structurally; use project validate for references.
`;
/** CLI operations are reusable and do not write output or terminate the process. */
export async function executeCommand(args: string[], cwd = process.cwd()): Promise<CommandResult> {
  if (args.length === 0 || args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) return {ok: true, diagnostics: [], exitCode: 0, message: help};
  if (args[0] === 'doctor' && args.length === 1) {
    if (Number(process.versions.node.split('.')[0]) < 20) return failure('doctor.node', 'Node.js 20 or newer is required');
    return {ok: true, diagnostics: [], exitCode: 0, message: `SDK runtime OK (Node.js ${process.versions.node}). Emulator and compiler adapters are not checked.`};
  }
  if (args[0] === 'project' && args[1] === 'validate' && args.length <= 3 && !args[2]?.startsWith('-')) {
    const r = await loadProject(resolve(cwd, args[2] ?? '.'));
    return {ok: r.ok, diagnostics: r.diagnostics, exitCode: r.ok ? 0 : 1};
  }
  if (['asset', 'sprite', 'animation'].includes(args[0]) && args[1] === 'validate' && args.length === 3 && !args[2].startsWith('-')) {
    const source = args[2];
    let value: unknown;
    try {
      const text = await readFile(resolve(cwd, source), 'utf8');
      try { value = JSON.parse(text); }
      catch (e) { return failure('asset.json', e instanceof Error ? e.message : String(e), 1, source); }
    } catch (e) { return failure('asset.io', e instanceof Error ? e.message : String(e), 1, source); }
    const kind: AssetKind | undefined = args[0] === 'sprite' ? 'shapes' : args[0] === 'animation' ? 'animations' : undefined;
    const r = checkAsset(value, kind);
    return {ok: r.ok, diagnostics: r.diagnostics.map(d => ({...d, source})), exitCode: r.ok ? 0 : 1};
  }
  return failure('cli.usage', 'Unknown command or invalid arguments. Run clementina --help.', 2);
}
export async function runCli(args: string[], output: {stdout(text: string): void; stderr(text: string): void}, cwd = process.cwd()): Promise<number> {
  const json = args.includes('--json');
  const r = await executeCommand(args.filter(a => a !== '--json'), cwd);
  if (json) output.stdout(JSON.stringify({version: 1, ...r}) + '\n');
  else {
    if (r.message) output.stdout(r.message.endsWith('\n') ? r.message : r.message + '\n');
    else if (r.ok) output.stdout('Validation passed.\n');
    for (const d of r.diagnostics) output.stderr(`${d.source ?? ''}${d.path ?? ''}: ${d.severity} ${d.code}: ${d.message}\n`);
  }
  return r.exitCode;
}
