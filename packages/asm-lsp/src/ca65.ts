/**
 * Errors and warnings from ca65 itself, as a build would report them. The
 * editor's text, saved or not, is assembled from a temporary copy with the
 * project's include directories, and ca65's messages are mapped back to the
 * files they name.
 */
import {spawn} from 'node:child_process';
import {accessSync, constants, existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {basename, delimiter, dirname, join, resolve} from 'node:path';

export interface Ca65Message {
  /** The file the message is about. */
  path: string;
  /** Zero-based line. */
  line: number;
  severity: 'error' | 'warning';
  message: string;
  /** ca65's notes about this message, such as where a macro was defined. */
  notes: Array<{path: string; line: number; message: string}>;
}

export interface Ca65Options {
  /** The ca65 executable. */
  ca65: string;
  /** Working directory: the project root, as in a build. */
  cwd: string;
  includeDirectories: string[];
  defines?: Record<string, string | number>;
  /** Milliseconds before ca65 is stopped. */
  timeout?: number;
}

const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Find ca65: a configured path, then the tools `clementina install` puts in
 * the Clementina home (`CLEMENTINA_HOME` or ~/.clementina), then PATH.
 */
export function findCa65(configured?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (configured) return configured;
  const name = process.platform === 'win32' ? 'ca65.exe' : 'ca65';
  const home = env.CLEMENTINA_HOME || join(homedir(), '.clementina');
  const candidates = [join(home, 'bin', name), join(home, 'tools', 'cc65', 'bin', name), ...(env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, name))];
  return candidates.find(path => existsSync(path) && executable(path));
}

/** Parse ca65's `file(line): Error: message` output; `rename` maps a reported path to the real one. */
export function parseCa65Output(output: string, cwd: string, rename: (path: string) => string = path => path): Ca65Message[] {
  const messages: Ca65Message[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(.*)\((\d+)\): (Error|Warning|Note): (.*)$/u.exec(line.trim());
    if (!match) continue;
    const path = rename(resolve(cwd, match[1]!));
    const lineNumber = Math.max(0, Number(match[2]) - 1);
    if (match[3] === 'Note') {
      messages.at(-1)?.notes.push({path, line: lineNumber, message: match[4]!});
      continue;
    }
    messages.push({path, line: lineNumber, severity: match[3] === 'Error' ? 'error' : 'warning', message: match[4]!, notes: []});
  }
  return messages;
}

function run(command: string, args: string[], cwd: string, timeout: number): Promise<{code: number; output: string}> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolveRun({code: code ?? 1, output}); });
  });
}

/**
 * Assemble a source's current text and return ca65's messages.
 *
 * @param path - The source file; its folder is searched first for includes, as ca65 does.
 * @param text - The text to assemble, which may differ from the file on disk.
 */
export async function assembleForDiagnostics(path: string, text: string, options: Ca65Options): Promise<Ca65Message[]> {
  const directory = await mkdtemp(join(tmpdir(), 'clementina-asm-'));
  try {
    const source = join(directory, basename(path));
    await writeFile(source, text);
    const args = ['--cpu', '65C02', '--include-dir', dirname(path), '--bin-include-dir', dirname(path)];
    for (const include of options.includeDirectories) if (existsSync(include)) args.push('--include-dir', include, '--bin-include-dir', include);
    for (const [name, value] of Object.entries(options.defines ?? {}).sort(([left], [right]) => left.localeCompare(right))) args.push('-D', `${name}=${value}`);
    args.push('-o', join(directory, 'out.o'), source);
    const {output} = await run(options.ca65, args, options.cwd, options.timeout ?? 10000);
    return parseCa65Output(output, options.cwd, reported => (reported === source ? resolve(path) : reported));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
