import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RateLimiter } from "./ratelimit";

// Feature: pinme-burnable-pin-messenger, Property 8: Sliding-window rate limiter
// **Validates: Requirements 4.13, 7.10, 9.4, 9.5, 12.7**

const CONFIGS = [
  { name: "messages 30/10s", limit: 30, windowMs: 10_000 },
  { name: "pings 1/10s", limit: 1, windowMs: 10_000 },
  { name: "invites 10/60min", limit: 10, windowMs: 60 * 60_000 },
] as const;

/** Naive reference: keeps every allowed timestamp and rescans it on each attempt. */
function naive(attempts: number[], limit: number, windowMs: number) {
  const allowed: number[] = [];
  return attempts.map((now) => {
    const inWindow = allowed.filter((t) => t > now - windowMs && t <= now);
    if (inWindow.length < limit) {
      allowed.push(now);
      return { ok: true, retryAfterMs: 0 };
    }
    // Time until the oldest in-window attempt (that blocks a slot) expires.
    const oldest = inWindow[inWindow.length - limit];
    return { ok: false, retryAfterMs: oldest + windowMs - now };
  });
}

/** Non-decreasing timestamps with gaps biased around the window size to hit boundaries. */
function timestamps(windowMs: number) {
  const gap = fc.oneof(
    { weight: 4, arbitrary: fc.integer({ min: 0, max: Math.max(1, Math.floor(windowMs / 20)) }) },
    { weight: 1, arbitrary: fc.constantFrom(0, 1, windowMs - 1, windowMs, windowMs + 1) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: windowMs * 2 }) },
  );
  return fc
    .tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.array(gap, { minLength: 0, maxLength: 120 }))
    .map(([start, gaps]) => {
      let t = start;
      return gaps.map((g) => (t += g));
    });
}

describe("Property 8: sliding-window rate limiter", () => {
  for (const { name, limit, windowMs } of CONFIGS) {
    describe(name, () => {
      it("matches the naive reference (allow decision and retryAfter)", () => {
        fc.assert(
          fc.property(timestamps(windowMs), (attempts) => {
            const rl = new RateLimiter();
            const expected = naive(attempts, limit, windowMs);
            attempts.forEach((now, i) => {
              const got = rl.allow("k", now, limit, windowMs);
              expect(got.ok).toBe(expected[i].ok);
              expect(got.retryAfterMs).toBe(Math.max(expected[i].ok ? 0 : 1, expected[i].retryAfterMs));
            });
          }),
          { numRuns: 200 },
        );
      });

      it("never has more than `limit` allowed attempts in any window; retrying after retryAfter succeeds", () => {
        fc.assert(
          fc.property(timestamps(windowMs), (attempts) => {
            const rl = new RateLimiter();
            const allowedTimes: number[] = [];
            for (const now of attempts) {
              const r = rl.allow("k", now, limit, windowMs);
              if (r.ok) allowedTimes.push(now);
              else {
                expect(r.retryAfterMs).toBeGreaterThan(0);
                expect(r.retryAfterMs).toBeLessThanOrEqual(windowMs);
                // At now + retryAfter a slot is free (without mutating the real limiter).
                const probe = new RateLimiter(rl.snapshot());
                expect(probe.allow("k", now + r.retryAfterMs, limit, windowMs).ok).toBe(true);
                // One ms earlier it is still denied.
                const early = new RateLimiter(rl.snapshot());
                expect(early.allow("k", now + r.retryAfterMs - 1, limit, windowMs).ok).toBe(false);
              }
            }
            for (let i = 0; i + limit < allowedTimes.length; i++) {
              expect(allowedTimes[i + limit] - allowedTimes[i]).toBeGreaterThanOrEqual(windowMs);
            }
          }),
          { numRuns: 100 },
        );
      });

      it("keys are independent and snapshot/restore preserves behaviour", () => {
        fc.assert(
          fc.property(
            fc.array(fc.boolean(), { minLength: 0, maxLength: 60 }),
            timestamps(windowMs),
            (keyPicks, attempts) => {
              const n = Math.min(keyPicks.length, attempts.length);
              const rl = new RateLimiter();
              const perKey: Record<string, number[]> = { a: [], b: [] };
              const seq: { key: string; now: number; ok: boolean }[] = [];
              for (let i = 0; i < n; i++) {
                const key = keyPicks[i] ? "a" : "b";
                perKey[key].push(attempts[i]);
                // Round-trip state through JSON as DO storage would.
                const restored = new RateLimiter(JSON.parse(JSON.stringify(rl.snapshot())));
                const r = restored.allow(key, attempts[i], limit, windowMs);
                // Apply same call to the live limiter for continuity.
                rl.allow(key, attempts[i], limit, windowMs);
                seq.push({ key, now: attempts[i], ok: r.ok });
              }
              for (const key of ["a", "b"]) {
                const exp = naive(perKey[key], limit, windowMs);
                expect(seq.filter((s) => s.key === key).map((s) => s.ok)).toEqual(exp.map((e) => e.ok));
              }
            },
          ),
          { numRuns: 100 },
        );
      });
    });
  }
});
