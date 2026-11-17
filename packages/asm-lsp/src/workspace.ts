/**
 * The assembly files an editor knows about, parsed, with symbol resolution
 * across `.include`s and modules: what a name at a position refers to, and
 * every place that refers to the same definition. Paths are plain file
 * system paths; the server turns them into URIs.
 */
import {dirname, isAbsolute, join, normalize} from 'node:path';
import {evaluate} from './expression.js';
import {parseAsm, qualifiedName, type AsmReference, type AsmSymbol, type ParsedFile, type Span} from './parser.js';

export interface WorkspaceFile {
  path: string;
  parsed: ParsedFile;
  /** True for the Clementina library's files, which are read-only. */
  library: boolean;
}

export interface Target {
  path: string;
  symbol: AsmSymbol;
}

export interface Occurrence {
  path: string;
  span: Span;
}

const contains = (span: Span, line: number, character: number) => span.line === line && character >= span.start && character <= span.end;

/** The scope chain from innermost to the top level: `a::b` gives `a::b`, `a`, ``. */
function scopeChain(scope: string): string[] {
  const parts = scope ? scope.split('::') : [];
  const chain: string[] = [];
  for (let length = parts.length; length >= 0; length -= 1) chain.push(parts.slice(0, length).join('::'));
  return chain;
}

const lastPart = (name: string) => name.slice(name.lastIndexOf(':') + 1);
const targetId = (target: Target) => `${target.path}#${target.symbol.span.line}:${target.symbol.span.start}`;

export class AsmWorkspace {
  readonly files = new Map<string, WorkspaceFile>();
  /** Addresses of labels from the last build's label file, by name. */
  addresses = new Map<string, number>();

  /**
   * @param includeDirectories - Where `.include` looks after the including file's folder, for a file.
   */
  constructor(public includeDirectories: (path: string) => string[] = () => []) {}

  /** Parse and remember a file's text. */
  set(path: string, text: string, library = false): WorkspaceFile {
    const file = {path: normalize(path), parsed: parseAsm(text), library};
    this.files.set(file.path, file);
    return file;
  }

  delete(path: string): void {
    this.files.delete(normalize(path));
  }

  get(path: string): WorkspaceFile | undefined {
    return this.files.get(normalize(path));
  }

  /** The known file an `.include` names, looking where ca65 does. */
  resolveInclude(from: string, include: string): string | undefined {
    if (isAbsolute(include)) return this.files.has(normalize(include)) ? normalize(include) : undefined;
    for (const directory of [dirname(from), ...this.includeDirectories(from)]) {
      const candidate = normalize(join(directory, include));
      if (this.files.has(candidate)) return candidate;
    }
    return undefined;
  }

  /** The file and the files it includes, directly or not, in include order. */
  visibleFiles(path: string): WorkspaceFile[] {
    const seen = new Set<string>();
    const out: WorkspaceFile[] = [];
    const visit = (current: string) => {
      const file = this.files.get(current);
      if (!file || seen.has(current)) return;
      seen.add(current);
      out.push(file);
      for (const include of file.parsed.includes) {
        if (include.binary) continue;
        const resolved = this.resolveInclude(current, include.path);
        if (resolved) visit(resolved);
      }
    };
    visit(normalize(path));
    return out;
  }

  /** A definition of a qualified name among files, preferring a real definition to an import. */
  private find(files: WorkspaceFile[], qualified: string): Target | undefined {
    let imported: Target | undefined;
    for (const file of files) {
      for (const symbol of file.parsed.symbols) {
        if (symbol.kind === 'local' || qualifiedName(symbol) !== qualified) continue;
        if (symbol.kind !== 'import') return {path: file.path, symbol};
        imported ??= {path: file.path, symbol};
      }
    }
    return imported;
  }

  /** Where an imported name is defined: the module that exports it, else any top-level definition. */
  private exported(name: string): Target | undefined {
    let fallback: Target | undefined;
    for (const file of this.files.values()) {
      for (const symbol of file.parsed.symbols) {
        if (symbol.scope !== '' || symbol.name !== name || symbol.kind === 'import' || symbol.kind === 'local') continue;
        if (file.parsed.exports.has(name)) return {path: file.path, symbol};
        fallback ??= {path: file.path, symbol};
      }
    }
    return fallback;
  }

  /** The definition a reference in a file resolves to. */
  resolve(path: string, reference: Pick<AsmReference, 'name' | 'scope' | 'cheapScope'>): Target | undefined {
    const file = this.get(path);
    if (!file) return undefined;
    const {name} = reference;
    if (name.startsWith('@')) {
      const symbol = file.parsed.symbols.find(item => item.kind === 'local' && item.name === name && item.cheapScope === reference.cheapScope);
      return symbol && {path: file.path, symbol};
    }
    const visible = this.visibleFiles(path);
    let found: Target | undefined;
    if (name.startsWith('::')) {
      found = this.find(visible, name.slice(2));
    } else {
      for (const scope of scopeChain(reference.scope)) {
        found = this.find(visible, scope ? `${scope}::${name}` : name);
        if (found) break;
      }
    }
    if (found && found.symbol.kind !== 'import') return found;
    const bare = name.replace(/^::/u, '');
    if (!bare.includes('::')) return this.exported(bare) ?? found;
    return found;
  }

  /** Resolve a definition to the one it stands for: an import's exported definition, or itself. */
  private canonical(target: Target): Target {
    if (target.symbol.kind !== 'import') return target;
    return this.exported(target.symbol.name) ?? target;
  }

  /** The definition at or referred to at a position, with the span under the cursor. */
  targetAt(path: string, line: number, character: number): {target: Target; span: Span} | undefined {
    const file = this.get(path);
    if (!file) return undefined;
    const symbol = file.parsed.symbols.find(item => contains(item.span, line, character));
    if (symbol) return {target: this.canonical({path: file.path, symbol}), span: symbol.span};
    const reference = file.parsed.references.find(item => contains(item.span, line, character));
    if (!reference) return undefined;
    const target = this.resolve(path, reference);
    return target && {target: this.canonical(target), span: reference.span};
  }

  /** The unnamed label a `:+` or `:-` at a position refers to. */
  unnamedTargetAt(path: string, line: number, character: number): Occurrence | undefined {
    const file = this.get(path);
    const reference = file?.parsed.unnamedReferences.find(item => contains(item.span, line, character));
    if (!file || !reference) return undefined;
    const labels = file.parsed.unnamedLabels;
    const target = reference.offset > 0
      ? labels.filter(item => item > line)[reference.offset - 1]
      : labels.filter(item => item < line).at(reference.offset);
    if (target === undefined) return undefined;
    return {path: file.path, span: {line: target, start: file.parsed.lines[target]!.indexOf(':'), end: file.parsed.lines[target]!.indexOf(':') + 1}};
  }

  /** Every occurrence of the definition at a position, across all known files. */
  occurrences(path: string, line: number, character: number, includeDeclaration = true): Occurrence[] {
    const at = this.targetAt(path, line, character);
    if (!at) return [];
    const wanted = targetId(at.target);
    const name = lastPart(at.target.symbol.name);
    const out: Occurrence[] = [];
    if (includeDeclaration) out.push({path: at.target.path, span: at.target.symbol.span});
    for (const file of this.files.values()) {
      for (const symbol of file.parsed.symbols) {
        if (symbol.kind !== 'import' || symbol.name !== name) continue;
        if (targetId(this.canonical({path: file.path, symbol})) === wanted && includeDeclaration) out.push({path: file.path, span: symbol.span});
      }
      for (const reference of file.parsed.references) {
        if (lastPart(reference.name) !== name) continue;
        const target = this.resolve(file.path, reference);
        if (target && targetId(this.canonical(target)) === wanted) out.push({path: file.path, span: reference.span});
      }
    }
    return out;
  }

  /** The value of a symbol as a number, when its definition is a constant expression or a built label. */
  valueOf(target: Target, depth = 0): number | undefined {
    const {symbol} = target;
    if (depth > 16) return undefined;
    if ((symbol.kind === 'label' || symbol.kind === 'proc') && symbol.scope === '') return this.addresses.get(symbol.name);
    if (symbol.offset !== undefined) return symbol.offset;
    if (symbol.kind === 'member' && symbol.value === undefined) return undefined;
    if (!['constant', 'variable', 'define', 'member'].includes(symbol.kind) || !symbol.value || symbol.params) return undefined;
    if (symbol.kind === 'member' && symbol.value.startsWith('.')) return undefined;
    const value = symbol.kind === 'member' ? symbol.value.replace(/^=\s*/u, '') : symbol.value;
    return evaluate(value, name => {
      const resolved = this.resolve(target.path, {name, scope: symbol.scope, cheapScope: symbol.cheapScope ?? 0});
      return resolved && resolved.symbol !== symbol ? this.valueOf(this.canonical(resolved), depth + 1) : undefined;
    });
  }

  /** Every definition in the workspace whose name matches, for completion and workspace symbols. */
  allSymbols(): Target[] {
    return [...this.files.values()].flatMap(file => file.parsed.symbols.map(symbol => ({path: file.path, symbol})));
  }
}
