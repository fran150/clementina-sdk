/** Convert an asset name to an uppercase ca65 identifier, using `ASSET` for an empty result. */
export const identifier = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'ASSET';
