/** Pure-ish relay helpers for PinMailbox: persisted message rate limit and error frames. */
import { MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS } from "../shared/limits";
import type { ErrorCode, ParseFailure, ServerMsg } from "../shared/protocol";
import { RateLimiter, type RateLimitResult, type RateLimitState } from "./ratelimit";

export const MESSAGE_QUOTA_KEY = "rl:msg";

export interface RateStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/** Consumes one message slot (30 per 10 s per sender PIN), persisted so hibernation keeps it. */
export async function checkMessageRate(
  storage: RateStorage,
  senderPin: string,
  now: number,
): Promise<RateLimitResult> {
  const state = (await storage.get<RateLimitState>(MESSAGE_QUOTA_KEY)) ?? {};
  const limiter = new RateLimiter(state);
  const result = limiter.allow(senderPin, now, MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_MS);
  limiter.prune(now, MESSAGE_RATE_WINDOW_MS);
  await storage.put(MESSAGE_QUOTA_KEY, limiter.snapshot());
  return result;
}

export function errorFrame(code: ErrorCode, extra: { ref?: string; field?: string; retryAfterMs?: number } = {}): ServerMsg {
  const frame: ServerMsg = { type: "error", code };
  if (extra.ref) frame.ref = extra.ref.slice(0, 64);
  if (extra.field) frame.field = extra.field;
  if (extra.retryAfterMs !== undefined) frame.retryAfterSec = Math.max(1, Math.ceil(extra.retryAfterMs / 1000));
  return frame;
}

/** Maps a parse failure to a validation_failed error frame (no content echoed). */
export function parseFailureFrame(failure: ParseFailure): ServerMsg {
  return errorFrame("validation_failed", failure.reason === "validation_failed" ? { field: failure.field } : {});
}
