/** Project-relative output and mounted SD-card locations for one build. */
export interface BuildPaths {
  outputDirectory: string;
  cardRoot: string;
}

/** Join project-relative path segments using portable separators. */
export function joinPortable(directory: string, filename: string): string {
  return `${directory}/${filename}`;
}

/** Locate a generated file under the active SD root. */
export function cardFile(paths: BuildPaths, filename: string): string {
  return paths.cardRoot === '.' ? joinPortable(paths.outputDirectory, filename) : joinPortable(paths.cardRoot, filename);
}

/** Convert a project-relative file path into a load-plan path. */
export function loadPath(paths: BuildPaths, path: string): string {
  return paths.cardRoot === '.' ? path : path.slice(paths.cardRoot.length + 1);
}
