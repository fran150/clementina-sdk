/** Default host polling interval while waiting for the emulator to stop. */
export const DEFAULT_POLL_INTERVAL_MS = 10;

/**
 * Validate stop-wait limits shared by the assembly and BASIC debug sessions.
 * @returns The effective polling interval.
 * @throws {RangeError} When the timeout or interval is not a usable positive integer.
 */
export function stopWaitInterval(options: {timeoutMs: number; pollIntervalMs?: number}): number {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new RangeError('timeoutMs must be a positive integer');
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isInteger(interval) || interval < 1 || interval > options.timeoutMs) throw new RangeError('pollIntervalMs must be 1..timeoutMs');
  return interval;
}

/** Wait for a host polling interval, removing the abort listener on every exit. */
export function waitForPoll(delayMs: number, signal: AbortSignal | undefined, abortError: () => Error): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    /** Reject promptly when the caller cancels this interval. */
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) onAbort();
  });
}
