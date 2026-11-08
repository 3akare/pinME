export const BACKOFF_START_MS = 1000;
export const BACKOFF_CAP_MS = 30000;

/** Next reconnect delay: start at 1000 ms, double each time, cap at 30000 ms. */
export function nextDelay(prev: number): number {
  if (!Number.isFinite(prev) || prev < BACKOFF_START_MS) return BACKOFF_START_MS;
  return Math.min(prev * 2, BACKOFF_CAP_MS);
}
