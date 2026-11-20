/**
 * ld65's own verdict on a linker configuration. ld65 reads the whole
 * configuration before it looks for object files, so running it with none
 * checks the configuration and writes nothing: its "No object files to link"
 * means the configuration passed.
 */
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {findTool} from './ca65.js';

export interface Ld65Message {
  /** Zero-based line, or undefined when ld65 named no line. */
  line?: number;
  severity: 'error' | 'warning';
  message: string;
}

/** Find ld65 as ca65 is found: a configured path, the Clementina home, then PATH. */
export function findLd65(configured?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return findTool('ld65', configured, env);
}

/** Parse ld65's `ld65: Error: file(line): message` lines about `config`. */
export function parseLd65Output(output: string, config: string, cwd: string): Ld65Message[] {
  const messages: Ld65Message[] = [];
  for (const raw of output.split(/\r?\n/u)) {
    const match = /^ld65: (Error|Warning): (?:(.*?)\((\d+)\): )?(.*)$/u.exec(raw.trim());
    if (!match) continue;
    const text = match[4]!;
    if (!match[2] && /^No object files to link$/u.test(text)) continue;
    if (match[2] && resolve(cwd, match[2]) !== resolve(config)) continue;
    messages.push({
      ...(match[3] ? {line: Math.max(0, Number(match[3]) - 1)} : {}),
      severity: match[1] === 'Error' ? 'error' : 'warning', message: text,
    });
  }
  return messages;
}

/**
 * Check a configuration's current text with ld65.
 *
 * @param path - The configuration's file; only its name is used.
 */
export async function checkWithLd65(path: string, text: string, ld65: string, timeout = 10000): Promise<Ld65Message[]> {
  const directory = await mkdtemp(join(tmpdir(), 'clementina-ld65-'));
  try {
    const config = join(directory, basename(path));
    await writeFile(config, text);
    const output = await new Promise<string>((resolveRun, reject) => {
      const child = spawn(ld65, ['-C', config, '-o', join(directory, 'out.bin')], {cwd: directory, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
      let collected = '';
      const timer = setTimeout(() => child.kill(), timeout);
      child.stdout.setEncoding('utf8').on('data', chunk => { collected += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { collected += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); resolveRun(collected); });
    });
    return parseLd65Output(output, config, directory);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
