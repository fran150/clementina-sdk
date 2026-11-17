/** Project-relative output and mounted SD-card locations for one build. */
export interface BuildPaths {
  outputDirectory: string;
  cardRoot: string;
}

/** Join project-relative path segments using portable separators. */
export function joinPortable(directory: string, filename: string): string {
  return `${directory}/${filename}`;
}

/** Locate a generated file in the card folder. */
export function cardFile(paths: BuildPaths, filename: string): string {
  return joinPortable(paths.cardRoot, filename);
}

/** Convert a project-relative card file path into a load-plan path, relative to the card. */
export function loadPath(paths: BuildPaths, path: string): string {
  return path.slice(paths.cardRoot.length + 1);
}
