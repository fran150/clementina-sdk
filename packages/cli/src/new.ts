import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {parseDocument} from 'yaml';
import {templateFiles} from './templates.js';

/** Template names accepted by `clementina new --template`. */
export const TEMPLATE_NAMES = Object.keys(templateFiles) as readonly string[];

/** The template `clementina new` uses without `--template`. */
export const DEFAULT_TEMPLATE = 'basic';

/** Options for creating a project from an embedded template. */
export interface NewProjectOptions {template?: string; name?: string}

/** A project written by `createProject`. */
export interface NewProject {root: string; template: string; name: string; files: string[]}

/** Why a project could not be created; `code` becomes the CLI diagnostic code. */
export class NewProjectError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Throw unless the destination is absent or an empty directory. */
async function checkDestination(root: string): Promise<void> {
  let entries: string[];
  try { entries = await readdir(root); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'ENOTDIR') throw new NewProjectError('project.new.exists', `Destination already exists: ${root}`);
    throw error;
  }
  if (entries.length) throw new NewProjectError('project.new.exists', `Destination already exists and is not empty: ${root}`);
}

/** Write an embedded template to a new (or empty) directory and set the project name. */
export async function createProject(destination: string, options: NewProjectOptions = {}): Promise<NewProject> {
  const template = options.template ?? DEFAULT_TEMPLATE;
  const files = Object.hasOwn(templateFiles, template) ? templateFiles[template] : undefined;
  if (!files) throw new NewProjectError('project.new.template', `Unknown template ${template}; expected ${TEMPLATE_NAMES.join(' or ')}`);
  const root = resolve(destination);
  const name = options.name ?? basename(root);
  if (!name.trim() || name.length > 80) {
    throw new NewProjectError('project.new.name', 'Project name must be 1..80 characters; pass --name');
  }
  await checkDestination(root);
  const manifest = parseDocument(files['clementina.yaml']);
  manifest.set('name', name);
  const contents: Record<string, string> = {...files, 'clementina.yaml': String(manifest)};
  for (const [path, text] of Object.entries(contents)) {
    const target = join(root, path);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, text, {flag: 'wx'});
  }
  return {root, template, name, files: Object.keys(contents)};
}
