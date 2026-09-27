import {spawnSync} from 'node:child_process';
import {access, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {delimiter, isAbsolute, resolve} from 'node:path';

export interface ToolProbe {found: boolean; path?: string; detail?: string}

async function executable(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch { return false; }
}

/** Locate a command without a shell, honoring an explicit path or PATH. */
export async function findExecutable(command: string, cwd = process.cwd()): Promise<string | undefined> {
  if (!command || /[\u0000\r\n]/u.test(command)) return undefined;
  const hasPath = command.includes('/') || command.includes('\\');
  const directories = hasPath ? [''] : (process.env.PATH ?? '').split(delimiter);
  const extensions = process.platform === 'win32' && !/\.[^./\\]+$/u.test(command)
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = hasPath
        ? (isAbsolute(command) ? command + extension : resolve(cwd, command + extension))
        : resolve(directory || cwd, command + extension);
      if (await executable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Check the installed toolchain by running its harmless version command. */
export async function probeTool(name: 'ca65' | 'ld65' | 'ar65' | 'emulator', command: string, cwd = process.cwd()): Promise<ToolProbe> {
  const path = await findExecutable(command, cwd);
  if (!path) return {found: false, detail: `${command} is not executable or is not on PATH`};
  if (name === 'emulator') return {found: true, path};
  const result = spawnSync(path, [name === 'ar65' ? 'V' : '--version'], {encoding: 'utf8', timeout: 5000, windowsHide: true});
  if (result.error || result.status !== 0) return {
    found: false, path,
    detail: `${command} did not complete its version check${result.error ? `: ${result.error.message}` : ''}`,
  };
  const version = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().split(/\r?\n/u).find(Boolean);
  return {found: true, path, ...(version ? {detail: version} : {})};
}
