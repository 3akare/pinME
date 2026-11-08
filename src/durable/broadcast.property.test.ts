import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { processBroadcast, type BroadcastCallbacks } from "./broadcast";
import type { Envelope } from "../shared/protocol";
// Feature: pinme-burnable-pin-messenger, Property 27: Broadcast processing
// **Validates: Requirements 12.3, 12.6, 12.8, 12.10**

const PINS = ["AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE"];

const envelopes = (max: number, min = 0) =>
  fc
    .array(fc.constantFrom(...PINS), { minLength: min, maxLength: max })
    .map((tos) => tos.map((to, i) => ({ messageId: `m${i}`, to }) as unknown as Envelope));

/** Fake callbacks: contacts set, and a rate window with `slots` free slots. */
function fakes(contacts: Set<string>, slots: number) {
  const forwarded: string[] = [];
  let consumed = 0;
  const cb: BroadcastCallbacks = {
    checkContact: async (e) => (contacts.has(e.to) ? { ok: true } : { ok: false, error: "not_contact" as never }),
    consumeRate: async () => {
      if (consumed >= slots) return { ok: false, retryAfterMs: 1234 };
      consumed++;
      return { ok: true };
    },
    forward: async (e) => {
      forwarded.push(e.messageId);
      return { ok: true };
    },
  };
  return { cb, forwarded, consumed: () => consumed };
}

describe("Property 27: broadcast processing", () => {
  it("rejects more than 100 envelopes whole with no forwards", async () => {
    await fc.assert(
      fc.asyncProperty(envelopes(130, 101), fc.nat(200), async (envs, slots) => {
        const f = fakes(new Set(PINS), slots);
        const r = await processBroadcast(envs, f.cb);
        expect(r.accepted).toEqual([]);
        expect(r.errors).toEqual([{ code: "envelope_limit_exceeded" }]);
        expect(f.forwarded).toEqual([]);
        expect(f.consumed()).toBe(0);
      }),
      { numRuns: 30 },
    );
  });

  it("matches an in-order reference model for contacts and rate limit", async () => {
    await fc.assert(
      fc.asyncProperty(
        envelopes(100),
        fc.subarray(PINS),
        fc.nat(120),
        async (envs, contactList, slots) => {
          const contacts = new Set(contactList);
          const f = fakes(contacts, slots);
          const r = await processBroadcast(envs, f.cb);

          // Reference model.
          const accepted: string[] = [];
          const errors: { code: string; ref: string; to: string }[] = [];
          let left = slots;
          for (let i = 0; i < envs.length; i++) {
            const e = envs[i]!;
            if (!contacts.has(e.to)) {
              errors.push({ code: "not_contact", ref: e.messageId, to: e.to });
              continue;
            }
            if (left === 0) {
              for (const rest of envs.slice(i)) errors.push({ code: "rate_limited", ref: rest.messageId, to: rest.to });
              break;
            }
            left--;
            accepted.push(e.messageId);
          }

          expect(r.accepted).toEqual(accepted);
          expect(f.forwarded).toEqual(accepted);
          expect(r.errors.map((x) => ({ code: x.code, ref: x.ref, to: x.to }))).toEqual(errors);
          // Every rejection identifies recipient and Message_ID.
          for (const x of r.errors) {
            expect(x.ref).toBeTruthy();
            expect(x.to).toBeTruthy();
          }
          // One rate slot per envelope that passed the contact check, never more.
          expect(f.consumed()).toBe(accepted.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
