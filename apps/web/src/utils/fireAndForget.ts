/**
 * Handlers for promises we deliberately do not await. Every fire-and-forget
 * promise must go through one of these so a rejection is always handled
 * explicitly instead of surfacing as an unhandled promise rejection.
 *
 * The two helpers encode the project's error policy:
 *
 * - `ignoreRejection` — for background *server syncs*: failing is normal while
 *   offline. The outbox keeps the queued write and retries on the next mount,
 *   so there is nothing to report.
 * - `logRejection` — for *local* database work: it should never fail in normal
 *   operation, so a failure means a real bug. Log it and keep the UI usable
 *   rather than crashing the view over it.
 */
export function ignoreRejection(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined,
  );
}

export function logRejection(promise: Promise<unknown>, what: string): Promise<void> {
  return promise.then(
    () => undefined,
    (err: unknown) => {
      console.error(`${what} failed`, err);
    },
  );
}
