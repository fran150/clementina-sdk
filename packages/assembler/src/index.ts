import {spawn} from 'node:child_process';
import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {basename, isAbsolute, relative, resolve} from 'node:path';
import {encodePrg, type PrgLoadStep} from '@clementina/basic';
import {diagnostic, result, type ClementinaDiagnostic, type ValidationResult} from '@clementina/core';
import {resolveProjectPath} from '@clementina/project/node';

export interface Ca65Toolchain {
  ca65?: string;
  ld65?: string;
}

export interface AssemblyBuildRequest {
  /** Project-relative assembly sources, in deterministic link order. */
  sources: string[];
  /** Project-relative ld65 configuration. Memory placement remains owned by this file. */
  linkerConfig: string;
  /** Project-relative directory for objects and final artifacts. */
  outputDirectory: string;
  /** Portable artifact stem, without an extension. */
  outputName: string;
  /** Expected first byte address in the linked binary. Checked against ld65 debug data. */
  loadAddress: number;
  /** Exported or scoped label used as the terminal run address. */
  entrySymbol: string;
  /** Required when loadAddress is in $8000-$BFFF. */
  bank?: number;
  includeDirectories?: string[];
  defines?: Record<string, string | number>;
  toolchain?: Ca65Toolchain;
}

export interface DebugSourceFile {id: number; path: string}
export interface DebugLine {id: number; fileId: number; line: number; spanId?: number}
export interface DebugSegment {id: number; name: string; start: number; size: number; outputName?: string; outputOffset?: number}
export interface DebugSymbol {id: number; name: string; value: number; segmentId?: number; definitionLineId?: number; scopeId?: number; type?: string}
export interface Ca65DebugInfo {
  version: {major: number; minor: number};
  files: DebugSourceFile[];
  lines: DebugLine[];
  segments: DebugSegment[];
  symbols: DebugSymbol[];
}

export interface AssemblyBuildResult {
  binary: Uint8Array;
  prg: Uint8Array;
  loadStep: PrgLoadStep;
  entryAddress: number;
  debug: Ca65DebugInfo;
  artifacts: {
    binary: string;
    prg: string;
    debug: string;
    map: string;
    labels: string;
    objects: string[];
    listings: string[];
  };
}

export interface ProcessInvocation {command: string; args: string[]; cwd: string}
export interface ProcessResult {exitCode: number; stdout: string; stderr: string}
export type ProcessRunner = (invocation: ProcessInvocation) => Promise<ProcessResult>;

const portablePath = (value: string): boolean => value.length > 0 && value.length <= 255
  && !value.startsWith('/') && !/^[A-Za-z]:/u.test(value) && !/[\\\u0000-\u001f\u007f]/u.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
const symbolPattern = /^[A-Za-z_@][A-Za-z0-9_@.$]*$/u;
const definePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const outputPattern = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u;

function validateRequest(request: AssemblyBuildRequest): ClementinaDiagnostic[] {
  const diagnostics: ClementinaDiagnostic[] = [];
  if (!Array.isArray(request.sources) || request.sources.length === 0) diagnostics.push(diagnostic('assembler.sources', '/sources', 'At least one assembly source is required'));
  for (const [index, path] of (request.sources ?? []).entries()) if (!portablePath(path)) diagnostics.push(diagnostic('assembler.path', `/sources/${index}`, 'Expected a project-relative portable path'));
  for (const [index, path] of (request.includeDirectories ?? []).entries()) if (!portablePath(path)) diagnostics.push(diagnostic('assembler.path', `/includeDirectories/${index}`, 'Expected a project-relative portable path'));
  if (!portablePath(request.linkerConfig)) diagnostics.push(diagnostic('assembler.path', '/linkerConfig', 'Expected a project-relative portable path'));
  if (!portablePath(request.outputDirectory)) diagnostics.push(diagnostic('assembler.path', '/outputDirectory', 'Expected a project-relative portable path'));
  if (!outputPattern.test(request.outputName)) diagnostics.push(diagnostic('assembler.output-name', '/outputName', 'Expected a portable filename stem beginning with a letter'));
  if (!Number.isInteger(request.loadAddress) || request.loadAddress < 1 || request.loadAddress > 0xbfff) diagnostics.push(diagnostic('assembler.load-address', '/loadAddress', 'Expected a CPU load address from $0001 through $BFFF'));
  if (!symbolPattern.test(request.entrySymbol)) diagnostics.push(diagnostic('assembler.entry-symbol', '/entrySymbol', 'Expected a ca65 symbol name'));
  if (request.bank !== undefined && (!Number.isInteger(request.bank) || request.bank < 1 || request.bank > 31)) diagnostics.push(diagnostic('assembler.bank', '/bank', 'Expected a bank from 1 through 31'));
  if (request.loadAddress >= 0x8000 && request.bank === undefined) diagnostics.push(diagnostic('assembler.bank', '/bank', 'A bank is required for images linked at $8000-$BFFF'));
  if (request.loadAddress < 0x8000 && request.bank !== undefined) diagnostics.push(diagnostic('assembler.bank', '/bank', 'A bank is only valid for images linked at $8000-$BFFF'));
  for (const key of Object.keys(request.defines ?? {})) if (!definePattern.test(key)) diagnostics.push(diagnostic('assembler.define', `/defines/${key}`, 'Expected a ca65 identifier'));
  return diagnostics;
}

function splitAttributes(text: string): Record<string, string> {
  const fields: string[] = [];
  let current = '', quoted = false, escaped = false;
  for (const character of text) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\' && quoted) { current += character; escaped = true; continue; }
    if (character === '"') quoted = !quoted;
    if (character === ',' && !quoted) { fields.push(current); current = ''; }
    else current += character;
  }
  fields.push(current);
  return Object.fromEntries(fields.map(field => {
    const equals = field.indexOf('=');
    return equals < 0 ? [field, ''] : [field.slice(0, equals), field.slice(equals + 1)];
  }));
}

function textValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  return value;
}
function integer(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = value.startsWith('0x') ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse the stable record-oriented ld65 debug format used for source mapping. */
export function parseCa65Debug(text: string): Ca65DebugInfo {
  const debug: Ca65DebugInfo = {version: {major: 0, minor: 0}, files: [], lines: [], segments: [], symbols: []};
  for (const rawLine of text.split(/\r?\n/u)) {
    if (!rawLine) continue;
    const tab = rawLine.indexOf('\t');
    if (tab < 0) continue;
    const kind = rawLine.slice(0, tab), fields = splitAttributes(rawLine.slice(tab + 1));
    if (kind === 'version') debug.version = {major: integer(fields.major) ?? 0, minor: integer(fields.minor) ?? 0};
    else if (kind === 'file') debug.files.push({id: integer(fields.id) ?? -1, path: textValue(fields.name) ?? ''});
    else if (kind === 'line') debug.lines.push({id: integer(fields.id) ?? -1, fileId: integer(fields.file) ?? -1, line: integer(fields.line) ?? 0, ...(integer(fields.span) === undefined ? {} : {spanId: integer(fields.span)})});
    else if (kind === 'seg') debug.segments.push({
      id: integer(fields.id) ?? -1, name: textValue(fields.name) ?? '', start: integer(fields.start) ?? 0, size: integer(fields.size) ?? 0,
      ...(textValue(fields.oname) === undefined ? {} : {outputName: textValue(fields.oname)}),
      ...(integer(fields.ooffs) === undefined ? {} : {outputOffset: integer(fields.ooffs)}),
    });
    else if (kind === 'sym' && integer(fields.val) !== undefined) debug.symbols.push({
      id: integer(fields.id) ?? -1, name: textValue(fields.name) ?? '', value: integer(fields.val)!,
      ...(integer(fields.seg) === undefined ? {} : {segmentId: integer(fields.seg)}),
      ...(integer(fields.def) === undefined ? {} : {definitionLineId: integer(fields.def)}),
      ...(integer(fields.scope) === undefined ? {} : {scopeId: integer(fields.scope)}),
      ...(textValue(fields.type) === undefined ? {} : {type: textValue(fields.type)}),
    });
  }
  if (debug.version.major !== 2) throw new TypeError(`Unsupported ld65 debug format ${debug.version.major}.${debug.version.minor}`);
  return debug;
}

export const runProcess: ProcessRunner = invocation => new Promise((resolveRun, reject) => {
  const child = spawn(invocation.command, invocation.args, {cwd: invocation.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => resolveRun({exitCode: code ?? 1, stdout, stderr}));
});

function toolFailure(tool: string, source: string, process: ProcessResult): ClementinaDiagnostic {
  const detail = process.stderr.trim() || process.stdout.trim() || `${tool} exited with status ${process.exitCode}`;
  return {...diagnostic('assembler.tool', '', detail), source};
}

/** Assemble and link a contiguous CPU image, verify placement, and package it as a Clementina PRG. */
export async function buildAssembly(projectRoot: string, request: AssemblyBuildRequest, runner: ProcessRunner = runProcess): Promise<ValidationResult<AssemblyBuildResult>> {
  const diagnostics = validateRequest(request);
  if (diagnostics.length) return result(undefined, diagnostics);
  try {
    const root = await realpath(projectRoot);
    const outputDirectory = await resolveProjectPath(root, request.outputDirectory);
    const config = await resolveProjectPath(root, request.linkerConfig);
    const sources = await Promise.all(request.sources.map(path => resolveProjectPath(root, path)));
    const includeDirectories = await Promise.all((request.includeDirectories ?? []).map(path => resolveProjectPath(root, path)));
    await mkdir(outputDirectory, {recursive: true});

    const objects: string[] = [], listings: string[] = [];
    const ca65 = request.toolchain?.ca65 ?? 'ca65', ld65 = request.toolchain?.ld65 ?? 'ld65';
    for (const [index, source] of sources.entries()) {
      const stem = `${String(index).padStart(3, '0')}-${basename(source).replace(/\.[^.]*$/u, '')}`;
      const object = `${outputDirectory}/${stem}.o`, listing = `${outputDirectory}/${stem}.lst`;
      const args = ['--cpu', '65C02', '--debug-info', '--listing', listing];
      for (const directory of includeDirectories) args.push('--include-dir', directory);
      for (const [name, value] of Object.entries(request.defines ?? {}).sort(([a], [b]) => a.localeCompare(b))) args.push('--define', `${name}=${value}`);
      args.push('-o', object, source);
      const assembled = await runner({command: ca65, args, cwd: root});
      if (assembled.exitCode !== 0) return result(undefined, [toolFailure('ca65', request.sources[index], assembled)]);
      objects.push(object); listings.push(listing);
    }

    const base = `${outputDirectory}/${request.outputName}`;
    const binaryPath = `${base}.bin`, prgPath = `${base}.prg`, debugPath = `${base}.dbg`, mapPath = `${base}.map`, labelsPath = `${base}.lbl`;
    const linked = await runner({command: ld65, args: ['--config', config, '-o', binaryPath, '--dbgfile', debugPath, '--mapfile', mapPath, '-Ln', labelsPath, ...objects], cwd: root});
    if (linked.exitCode !== 0) return result(undefined, [toolFailure('ld65', request.linkerConfig, linked)]);

    const [binaryBuffer, debugText] = await Promise.all([readFile(binaryPath), readFile(debugPath, 'utf8')]);
    const binary = new Uint8Array(binaryBuffer.buffer, binaryBuffer.byteOffset, binaryBuffer.byteLength);
    const debug = parseCa65Debug(debugText);
    debug.files = debug.files.map(file => {
      if (!isAbsolute(file.path)) return file;
      const path = relative(root, file.path).split('\\').join('/');
      return path === '..' || path.startsWith('../') ? file : {...file, path};
    });
    const emitted = debug.segments.filter(segment => segment.size > 0 && segment.outputName !== undefined && segment.outputOffset !== undefined);
    if (emitted.length === 0) return result(undefined, [diagnostic('assembler.image.empty', '', 'ld65 debug data contains no emitted segments')]);
    for (const segment of emitted) {
      if (resolve(root, segment.outputName!) !== binaryPath) {
        diagnostics.push(diagnostic('assembler.image.multiple-output', '', `Segment ${segment.name} is emitted to a separate file; a Clementina PRG build requires one contiguous output`));
        continue;
      }
      const expected = request.loadAddress + segment.outputOffset!;
      if (segment.start !== expected) diagnostics.push(diagnostic('assembler.image.placement', '', `Segment ${segment.name} starts at $${segment.start.toString(16).toUpperCase()}, but binary offset $${segment.outputOffset!.toString(16).toUpperCase()} requires $${expected.toString(16).toUpperCase()}`));
      if (segment.outputOffset! + segment.size > binary.length) diagnostics.push(diagnostic('assembler.image.bounds', '', `Segment ${segment.name} extends beyond the linked binary`));
    }
    const entries = debug.symbols.filter(symbol => symbol.name === request.entrySymbol);
    if (entries.length !== 1) diagnostics.push(diagnostic('assembler.entry-symbol', '/entrySymbol', entries.length === 0 ? `Symbol ${request.entrySymbol} is absent from ld65 debug data` : `Symbol ${request.entrySymbol} is ambiguous in ld65 debug data`));
    if (diagnostics.length) return result(undefined, diagnostics);
    const entryAddress = entries[0].value;
    if (entryAddress < 1 || entryAddress > 0xffff) return result(undefined, [diagnostic('assembler.entry-address', '/entrySymbol', 'Entry symbol is outside the 16-bit CPU address space')]);
    if (entryAddress < request.loadAddress || entryAddress >= request.loadAddress + binary.length) {
      return result(undefined, [diagnostic('assembler.entry-address', '/entrySymbol', 'Entry symbol is outside the linked PRG payload')]);
    }

    let prg: Uint8Array;
    try { prg = encodePrg(binary, request.loadAddress, request.bank); }
    catch (error) { return result(undefined, [diagnostic('assembler.prg', '', error instanceof Error ? error.message : String(error))]); }
    await writeFile(prgPath, prg);
    const relativePath = relative(root, prgPath).split('\\').join('/');
    const loadStep: PrgLoadStep = {
      kind: 'prg', path: relativePath, loadAddress: request.loadAddress, length: binary.length,
      ...(request.bank === undefined ? {} : {bank: request.bank}), runAddress: entryAddress,
    };
    return result({
      binary, prg, loadStep, entryAddress, debug,
      artifacts: {
        binary: relative(root, binaryPath).split('\\').join('/'), prg: relativePath,
        debug: relative(root, debugPath).split('\\').join('/'), map: relative(root, mapPath).split('\\').join('/'),
        labels: relative(root, labelsPath).split('\\').join('/'),
        objects: objects.map(path => relative(root, path).split('\\').join('/')),
        listings: listings.map(path => relative(root, path).split('\\').join('/')),
      },
    }, []);
  } catch (error) {
    return result(undefined, [diagnostic('assembler.io', '', error instanceof Error ? error.message : String(error))]);
  }
}
