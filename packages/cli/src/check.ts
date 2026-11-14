import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import type {buildProject} from '@clementina/build';
import {errorMessage, type ClementinaDiagnostic} from '@clementina/core';
import type {EmulatorState} from '@clementina/emulator-client';
import {resolveEmulatorExecutable, type EmulatorProcess, type EmulatorProcessOptions} from '@clementina/emulator-client/node';
import {loadProject, resolveProjectPath} from '@clementina/project/node';

/** specs/mia-ram-map.json: the VIDEO block is the whole snapshot `video()` returns. */
export const VIDEO_SNAPSHOT_BYTES = 68944;
/** specs/video.json: the OV_NT region and the overlay's 40x25 text grid. */
export const OVERLAY_NAMETABLE = {start: 65664, columns: 40, rows: 25} as const;
/** specs/video.json display: the native size a renderer's PNG must have. */
export const DISPLAY = {width: 320, height: 200} as const;

/** Cycles run before the first capture when no check file names a count. */
const DEFAULT_SETTLE_CYCLES = 3_000_000;
const MAX_SETTLE_CYCLES = 10_000_000;

/** `checks/smoke.json`: visible text before and after typing some input. */
export interface SmokeCheck {settleCycles: number; beforeText: string; input: string; afterText: string}
/** One expectation of `checks/code.json`. */
export interface MemoryCheck {address: number; bytes: number[]; phase?: 'before' | 'after'}
/** `checks/code.json`: CPU memory expected after the program settles (and after the smoke input). */
export interface CodeCheck {format: 'clementina-code-check'; version: 1; settleCycles: number; memory: MemoryCheck[]}

/** What `clementina check` observed at one point. */
export interface Capture {state: EmulatorState; videoBytes: number; videoSha256: string; overlayRows: string[]}

/** `build/inspection/report.json`. */
export interface CheckReport {
  format: 'clementina-game-inspection'; version: 1;
  project: string; parts: {assembly: boolean; basic: boolean}; loadPlan: string;
  before: Capture; after?: Capture;
  checks: {
    loadedPalette?: {assetId?: string; found: boolean};
    beforeText?: {expected: string; found: boolean};
    afterText?: {expected: string; found: boolean};
    videoChanged?: boolean;
    memory?: Array<{phase: 'before' | 'after'; address: number; expected: number[]; observed: (number | null)[]; found: boolean}>;
  };
}

/** Options for `checkProject`; the CLI fills them from its flags. */
export interface CheckOptions {emulator?: string; renderer?: string}

/** Side effects `checkProject` needs, replaceable in tests. */
export interface CheckDependencies {
  buildProject: typeof buildProject;
  startEmulatorProcess: (options: EmulatorProcessOptions) => Promise<EmulatorProcess>;
}

/** A finished inspection: where it was written, what it saw, and whether every check held. */
export interface CheckOutcome {output: string; report: CheckReport; passed: boolean; checked: boolean}

/** A check that could not run; the diagnostics say why. */
export class CheckError extends Error {
  constructor(readonly diagnostics: ClementinaDiagnostic[]) {
    super(diagnostics.map(entry => `${entry.source ?? ''}${entry.path ?? ''}: ${entry.code}: ${entry.message}`).join('\n'));
  }
}

/** One error diagnostic, optionally naming the project file it is about. */
const error = (code: string, message: string, source?: string): ClementinaDiagnostic =>
  ({severity: 'error', code, message, ...(source ? {source} : {})});

const fail = (code: string, message: string, source?: string): never => {
  throw new CheckError([error(code, message, source)]);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCycles = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SETTLE_CYCLES;

async function readCheck(root: string, path: string): Promise<unknown> {
  let raw: string;
  try { raw = await readFile(await resolveProjectPath(root, path), 'utf8'); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return fail('check.io', errorMessage(cause), path);
  }
  try { return JSON.parse(raw); }
  catch (cause) { return fail('check.json', errorMessage(cause), path); }
}

/** Read and check `checks/smoke.json`, if the project has one. */
export async function readSmokeCheck(root: string): Promise<SmokeCheck | undefined> {
  const value = await readCheck(root, 'checks/smoke.json');
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isCycles(value.settleCycles)
    || typeof value.beforeText !== 'string' || !value.beforeText
    || typeof value.afterText !== 'string' || !value.afterText
    || typeof value.input !== 'string' || !value.input || value.input.length > 64
    || [...value.input].some(char => char.charCodeAt(0) > 127)) {
    return fail('check.smoke', 'checks/smoke.json needs settleCycles (1..10000000), beforeText, ASCII input (1..64 bytes), and afterText', 'checks/smoke.json');
  }
  return value as unknown as SmokeCheck;
}

/** Read and check `checks/code.json`, if the project has one. */
export async function readCodeCheck(root: string): Promise<CodeCheck | undefined> {
  const value = await readCheck(root, 'checks/code.json');
  if (value === undefined) return undefined;
  const validItem = (item: unknown) => isRecord(item) && Number.isInteger(item.address)
    && (item.address as number) >= 0 && (item.address as number) <= 0xffff
    && Array.isArray(item.bytes) && item.bytes.length >= 1 && item.bytes.length <= 256
    && (item.address as number) + item.bytes.length <= 0x10000
    && item.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    && ['before', 'after'].includes((item.phase ?? 'before') as string);
  if (!isRecord(value) || value.format !== 'clementina-code-check' || value.version !== 1 || !isCycles(value.settleCycles)
    || !Array.isArray(value.memory) || value.memory.length < 1 || !value.memory.every(validItem)) {
    return fail('check.code', 'checks/code.json needs format, version 1, settleCycles (1..10000000), and bounded memory expectations', 'checks/code.json');
  }
  return value as unknown as CodeCheck;
}

/** The overlay text grid of a video snapshot, one trimmed string per row. */
export function overlayRows(video: readonly number[]): string[] {
  const {start, columns, rows} = OVERLAY_NAMETABLE;
  if (video.length !== VIDEO_SNAPSHOT_BYTES) fail('check.video', `Video snapshot has ${video.length} bytes; expected ${VIDEO_SNAPSHOT_BYTES}`);
  return Array.from({length: rows}, (_, row) => video
    .slice(start + row * columns, start + (row + 1) * columns)
    .map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' ')
    .join('').trimEnd());
}

function capture(state: EmulatorState, video: readonly number[]): Capture {
  return {
    state, videoBytes: video.length,
    videoSha256: createHash('sha256').update(Buffer.from(video)).digest('hex'),
    overlayRows: overlayRows(video),
  };
}

/** Render a snapshot through `clementina-render`, which reads a JSON byte array on stdin and writes a PNG. */
async function render(renderer: string, video: readonly number[], output: string): Promise<void> {
  const result = spawnSync(renderer, [], {input: JSON.stringify(video), maxBuffer: 4 * 1024 * 1024, windowsHide: true});
  if (result.error || result.status !== 0 || result.stdout.length < 24 || result.stdout.subarray(1, 4).toString() !== 'PNG'
    || result.stdout.readUInt32BE(16) !== DISPLAY.width || result.stdout.readUInt32BE(20) !== DISPLAY.height) {
    fail('check.renderer', `Renderer failed: ${result.error?.message ?? result.stderr.toString().trim()}`);
  }
  await writeFile(output, result.stdout);
}

/**
 * Validate, build, run the project in an owned headless emulator, and test
 * `checks/smoke.json` and `checks/code.json`. Writes `<outputDirectory>/inspection/`.
 */
export async function checkProject(directory: string, options: CheckOptions, dependencies: CheckDependencies): Promise<CheckOutcome> {
  const root = resolve(directory);
  const loaded = await loadProject(root);
  if (!loaded.ok) throw new CheckError(loaded.diagnostics);
  const built = await dependencies.buildProject(root);
  if (!built.ok) throw new CheckError(built.diagnostics);
  const build = built.value;
  const smoke = await readSmokeCheck(root);
  const code = await readCodeCheck(root);
  if (code?.memory.some(item => item.phase === 'after') && !smoke) {
    fail('check.code', 'After-input memory checks require checks/smoke.json', 'checks/code.json');
  }
  const outputDirectory = dirname(build.files.find(file => file.kind === 'load-plan')!.path);
  const output = await resolveProjectPath(root, `${outputDirectory}/inspection`);
  await mkdir(output, {recursive: true});
  let emulator: EmulatorProcess;
  try {
    emulator = await dependencies.startEmulatorProcess({
      executable: resolveEmulatorExecutable(options.emulator), sdRoot: resolve(root, build.sdRoot),
    });
  } catch (cause) { return fail('check.emulator', errorMessage(cause)); }
  let report: CheckReport;
  try {
    const client = emulator.client;
    const memory: NonNullable<CheckReport['checks']['memory']> = [];
    const checkMemory = async (phase: 'before' | 'after') => {
      for (const item of code?.memory.filter(check => (check.phase ?? 'before') === phase) ?? []) {
        const observed = await client.readMemory(item.address, item.bytes.length);
        memory.push({phase, address: item.address, expected: item.bytes, observed,
          found: item.bytes.every((byte, index) => observed[index] === byte)});
      }
    };
    // A palette load can still be completing after the ROM has echoed a command.
    // This is an automation processing budget, not a hardware timing constant.
    await client.launchLoadPlan(build.loadPlan, {inputCycles: 1_000_000});
    await client.pause();
    const beforeState = await client.step(smoke?.settleCycles ?? code?.settleCycles ?? DEFAULT_SETTLE_CYCLES);
    const beforeVideo = await client.video();
    await checkMemory('before');
    const before = capture(beforeState, beforeVideo);
    const paletteFile = build.files.find(file => file.kind === 'palette');
    let loadedPalette: CheckReport['checks']['loadedPalette'];
    if (paletteFile && paletteFile.address !== undefined) {
      const palette = await readFile(await resolveProjectPath(root, paletteFile.path));
      loadedPalette = {
        ...(paletteFile.assetId ? {assetId: paletteFile.assetId} : {}),
        found: palette.equals(Buffer.from(beforeVideo.slice(paletteFile.address, paletteFile.address + palette.length))),
      };
    }
    await writeFile(join(output, 'before.video.bin'), Buffer.from(beforeVideo));
    if (options.renderer) await render(options.renderer, beforeVideo, join(output, 'before.png'));

    let after: Capture | undefined;
    if (smoke) {
      await client.input(Array.from(smoke.input, char => char.charCodeAt(0)));
      const afterState = await client.step(smoke.settleCycles);
      const afterVideo = await client.video();
      await checkMemory('after');
      after = capture(afterState, afterVideo);
      await writeFile(join(output, 'after.video.bin'), Buffer.from(afterVideo));
      if (options.renderer) await render(options.renderer, afterVideo, join(output, 'after.png'));
    }
    const visible = (rows: string[]) => rows.join('\n');
    report = {
      format: 'clementina-game-inspection', version: 1,
      project: root, parts: {assembly: build.assembly !== undefined, basic: build.basic !== undefined},
      loadPlan: `${outputDirectory}/load-plan.json`,
      before, ...(after ? {after} : {}),
      checks: {
        ...(loadedPalette ? {loadedPalette} : {}),
        ...(smoke && after ? {
          beforeText: {expected: smoke.beforeText, found: visible(before.overlayRows).includes(smoke.beforeText)},
          afterText: {expected: smoke.afterText, found: visible(after.overlayRows).includes(smoke.afterText)},
          videoChanged: before.videoSha256 !== after.videoSha256,
        } : {}),
        ...(code ? {memory} : {}),
      },
    };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  } finally {
    await emulator.close();
  }
  const {checks} = report;
  const passed = checks.loadedPalette?.found !== false
    && checks.beforeText?.found !== false && checks.afterText?.found !== false && checks.videoChanged !== false
    && !checks.memory?.some(item => !item.found);
  return {output, report, passed, checked: Boolean(smoke || code)};
}

/** The diagnostics a finished inspection reports: one error per failed check. */
export function checkDiagnostics(report: CheckReport): ClementinaDiagnostic[] {
  const {checks} = report, out: ClementinaDiagnostic[] = [];
  if (checks.loadedPalette?.found === false) out.push(error('check.palette', `Palette config ${checks.loadedPalette.assetId ?? ''} is not in MIA palette memory`));
  if (checks.beforeText?.found === false) out.push(error('check.smoke.before', `Screen does not show "${checks.beforeText.expected}" before the input`, 'checks/smoke.json'));
  if (checks.afterText?.found === false) out.push(error('check.smoke.after', `Screen does not show "${checks.afterText.expected}" after the input`, 'checks/smoke.json'));
  if (checks.videoChanged === false) out.push(error('check.smoke.unchanged', 'Video did not change after the input', 'checks/smoke.json'));
  for (const item of checks.memory ?? []) {
    if (item.found) continue;
    const hex = (bytes: readonly (number | null)[]) => bytes.map(byte => byte === null ? '??' : byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    out.push(error('check.memory', `$${item.address.toString(16).toUpperCase().padStart(4, '0')} (${item.phase}): expected ${hex(item.expected)}, found ${hex(item.observed)}`, 'checks/code.json'));
  }
  return out;
}
