/** Error raised for invalid or unavailable debug-session operations. */
export class DebugSessionError extends Error {
  /** Create an error with a stable `name` for logs and editor clients. */
  constructor(message: string) {
    super(message);
    this.name = 'DebugSessionError';
  }
}
