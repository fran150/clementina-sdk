/** Return a source filename from a portable or Windows-style path. */
export function sourceName(path: string): string {
  return path.replaceAll('\\', '/').split('/').pop() ?? '';
}

/** Format a CPU address for an unmapped stack frame. */
export function cpuAddressLabel(address: number): string {
  return `$${address.toString(16).toUpperCase().padStart(4, '0')}`;
}
