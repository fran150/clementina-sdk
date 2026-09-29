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
