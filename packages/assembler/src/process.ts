import {spawn} from 'node:child_process';
import {diagnostic, type ClementinaDiagnostic} from '@clementina/core';
import type {ProcessResult, ProcessRunner} from './types.js';

/**
 * Spawn a tool without a shell and capture its UTF-8 output.
 *
 * @param invocation - Command, arguments, and working directory.
 * @returns Exit status and captured stdout and stderr.
 * @throws If the process cannot be started.
 */
export const runProcess: ProcessRunner = invocation => new Promise((resolveRun, reject) => {
  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk;
  });
  child.once('error', reject);
  child.once('close', code => resolveRun({exitCode: code ?? 1, stdout, stderr}));
});

/**
 * Turn a failed tool invocation into a diagnostic tied to its input file.
 *
 * @param tool - Tool name used when no output was captured.
 * @param source - Source or linker configuration associated with the failure.
 * @param process - Exit status and captured tool output.
 * @returns A diagnostic preferring stderr, then stdout, then the exit status.
 */
export function toolFailure(tool: string, source: string, process: ProcessResult): ClementinaDiagnostic {
  const detail = process.stderr.trim() || process.stdout.trim() || `${tool} exited with status ${process.exitCode}`;
  return {...diagnostic('assembler.tool', '', detail), source};
}
