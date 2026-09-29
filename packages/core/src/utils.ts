/**
 * Extracts a readable message from an unknown thrown value.
 * @param error - Value caught from a `catch` clause or a rejected promise.
 * @returns The error's message, or the value converted to a string.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Formats a number as an uppercase 6502-style hexadecimal literal, such as `$C000`.
 * @param value - Non-negative integer to format.
 * @param width - Minimum digit count; shorter values are zero-padded.
 * @returns The `$`-prefixed hexadecimal text.
 */
export function formatHex(value: number, width = 0): string {
  return `$${value.toString(16).toUpperCase().padStart(width, '0')}`;
}

/**
 * Tests whether a value is an integer inside an inclusive range.
 * @param value - Untrusted value to test.
 * @param min - Smallest accepted integer.
 * @param max - Largest accepted integer.
 * @returns Whether the value is an integer from `min` through `max`.
 */
export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/**
 * Runs asynchronous operations one at a time in submission order.
 * A rejected operation is reported to its caller and does not block later operations.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Queues an operation after every previously queued operation settles.
   * @param operation - Work to start once the queue is free.
   * @returns The operation's own result.
   */
  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Resolves once every operation queued so far has settled. */
  get idle(): Promise<void> {
    return this.tail;
  }
}
