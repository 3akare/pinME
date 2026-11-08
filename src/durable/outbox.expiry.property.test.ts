import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DELETE_RETRY_INTERVAL_MS,
  ENVELOPE_TTL_MS,
  ENV_PREFIX,
  MAX_DELETE_RETRIES,
  flushOutbox,
  runOutboxMaintenance,
  storeEnvelope,
  type OutboxStorage,
  type StoredEnvelope,
} from "./outbox";
// Feature: pinme-burnable-pin-messenger, Property 36: Envelope expiry and deletion retry
// **Validates: Requirements 17.7, 17.8**

/** In-memory storage; `failDeletes` is the number of upcoming delete calls (any key) that throw. */
class FakeStorage implements OutboxStorage {
  readonly map = new Map<string, unknown>();
  failDeletes = 0;
  deleteCalls: number[] = [];
  constructor(private readonly clock: { now: number }) {}
  async get<T>(key: string) {
    return this.map.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.map.set(key, structuredClone(value));
  }
  async delete(key: string) {
    this.deleteCalls.push(this.clock.now);
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new Error("storage failure");
    }
    return this.map.delete(key);
  }
  async list<T>(options: { prefix: string }) {
    const out = new Map<string, T>();
    for (const [k, v] of this.map) if (k.startsWith(options.prefix)) out.set(k, structuredClone(v) as T);
    return out;
  }
}

const mkRec = (id: number, storedAt: number): StoredEnvelope => ({
  from: "111111",
  storedAt,
  envelope: {
    to: "222222",
    messageId: `m${String(id).padStart(4, "0")}`,
    nonce: "AAAA",
    ciphertext: "AAAA",
  } as StoredEnvelope["envelope"],
});

describe("Property 36: envelope expiry and deletion retry", () => {
  it("purges exactly the envelopes older than 30 days", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
        fc.array(
          fc.oneof(
            fc.integer({ min: 0, max: 60 * 24 * 3600_000 }),
            fc.integer({ min: ENVELOPE_TTL_MS - 2, max: ENVELOPE_TTL_MS + 2 }),
          ),
          { maxLength: 20 },
        ),
        async (now, ages) => {
          const clock = { now };
          const storage = new FakeStorage(clock);
          const recs = ages.map((age, i) => mkRec(i, now - age));
          for (const r of recs) await storeEnvelope(storage, r);
          await runOutboxMaintenance(storage, now);
          const left = new Set([...(await storage.list<StoredEnvelope>({ prefix: ENV_PREFIX })).values()].map((r) => r.envelope.messageId));
          recs.forEach((r, i) => {
            const expired = ages[i] > ENVELOPE_TTL_MS;
            expect(left.has(r.envelope.messageId)).toBe(!expired);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("retries a failing delete at most 3 times at 5 s spacing and never re-sends", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
        fc.integer({ min: 0, max: 8 }), // consecutive delete failures
        fc.array(fc.integer({ min: 1, max: 7000 }), { minLength: 1, maxLength: 40 }), // clock steps
        async (start, k, steps) => {
          const clock = { now: start };
          const storage = new FakeStorage(clock);
          await storeEnvelope(storage, mkRec(1, start));
          storage.failDeletes = k;
          let sends = 0;
          const send = () => {
            sends++;
          };
          await flushOutbox(storage, send, clock.now);
          for (const step of steps) {
            clock.now += step;
            await runOutboxMaintenance(storage, clock.now);
            await flushOutbox(storage, send, clock.now);
          }
          // Run well past all retries (still far inside the 30-day TTL).
          for (let i = 0; i < 6; i++) {
            clock.now += DELETE_RETRY_INTERVAL_MS;
            await runOutboxMaintenance(storage, clock.now);
            await flushOutbox(storage, send, clock.now);
          }

          expect(sends).toBe(1);
          const attempts = storage.deleteCalls;
          expect(attempts.length).toBeLessThanOrEqual(1 + MAX_DELETE_RETRIES);
          expect(attempts.length).toBe(Math.min(k + 1, 1 + MAX_DELETE_RETRIES));
          // Spacing between consecutive attempts is at least 5 s.
          for (let i = 1; i < attempts.length; i++) {
            expect(attempts[i] - attempts[i - 1]).toBeGreaterThanOrEqual(DELETE_RETRY_INTERVAL_MS);
          }
          const held = await storage.list<StoredEnvelope>({ prefix: ENV_PREFIX });
          // Deleted if some attempt succeeded; otherwise kept (flagged sent) after exhausting retries.
          expect(held.size).toBe(k <= MAX_DELETE_RETRIES ? 0 : 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
