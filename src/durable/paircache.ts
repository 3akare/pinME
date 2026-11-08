/** Contact-pair cache with a 5 s TTL. Fails closed when the Directory is unreachable. */

export const PAIR_CACHE_TTL_MS = 5000;

export type PairVerdict =
  | { ok: true }
  | { ok: false; error: 'not_a_contact' | 'verification_unavailable' };

/** Resolves whether the pair is accepted; throws when the Directory is unreachable. */
export type PairFetcher = (otherPin: string) => Promise<boolean>;

interface Entry {
  accepted: boolean;
  fetchedAt: number;
}

export class PairCache {
  private entries = new Map<string, Entry>();

  constructor(private readonly ttlMs: number = PAIR_CACHE_TTL_MS) {}

  async check(otherPin: string, now: number, fetchPair: PairFetcher): Promise<PairVerdict> {
    const hit = this.entries.get(otherPin);
    if (hit && now - hit.fetchedAt >= 0 && now - hit.fetchedAt < this.ttlMs) {
      return hit.accepted ? { ok: true } : { ok: false, error: 'not_a_contact' };
    }
    this.entries.delete(otherPin);
    let accepted: boolean;
    try {
      accepted = await fetchPair(otherPin);
    } catch {
      // Expired entries are never used as a fallback: fail closed.
      return { ok: false, error: 'verification_unavailable' };
    }
    this.entries.set(otherPin, { accepted, fetchedAt: now });
    return accepted ? { ok: true } : { ok: false, error: 'not_a_contact' };
  }

  /** Clears every entry (pair added or removed). */
  invalidate(): void {
    this.entries.clear();
  }
}
