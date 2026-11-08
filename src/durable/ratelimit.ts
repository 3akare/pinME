/** Pure sliding-window rate limiter. State is plain JSON so it can be persisted in DO storage. */

export type RateLimitResult = { ok: true; retryAfterMs: 0 } | { ok: false; retryAfterMs: number };

/** key -> ascending timestamps (ms) of allowed hits still inside the window. */
export type RateLimitState = Record<string, number[]>;

export class RateLimiter {
  private state: RateLimitState;

  constructor(snapshot: RateLimitState = {}) {
    this.state = {};
    for (const [k, v] of Object.entries(snapshot)) this.state[k] = [...v];
  }

  /** Records a hit when allowed. Denied attempts are not recorded. */
  allow(key: string, now: number, limit: number, windowMs: number): RateLimitResult {
    const hits = (this.state[key] ?? []).filter((t) => t > now - windowMs && t <= now);
    if (limit <= 0) {
      this.state[key] = hits;
      return { ok: false, retryAfterMs: windowMs };
    }
    if (hits.length >= limit) {
      this.state[key] = hits;
      // The oldest hit that must expire to free a slot.
      const oldest = hits[hits.length - limit];
      return { ok: false, retryAfterMs: Math.max(1, oldest + windowMs - now) };
    }
    hits.push(now);
    this.state[key] = hits;
    return { ok: true, retryAfterMs: 0 };
  }

  /** Drops keys with no hits in the window to bound stored state. */
  prune(now: number, windowMs: number): void {
    for (const key of Object.keys(this.state)) {
      const hits = this.state[key].filter((t) => t > now - windowMs);
      if (hits.length === 0) delete this.state[key];
      else this.state[key] = hits;
    }
  }

  /** Serializable snapshot for DO storage. */
  snapshot(): RateLimitState {
    return JSON.parse(JSON.stringify(this.state)) as RateLimitState;
  }
}
