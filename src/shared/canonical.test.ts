import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { canonicalize, type CanonicalFields } from "./canonical";

const reqArb: fc.Arbitrary<CanonicalFields> = fc.record({
  pin: fc.string(),
  action: fc.string(),
  ts: fc.integer({ min: 0, max: 2 ** 52 }),
  nonce: fc.string(),
  payload: fc.jsonValue(),
});

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

describe("Property 39: Canonical encoding injectivity", () => {
  /**
   * **Validates: Requirements 19.2, 19.8**
   */
  it("is deterministic for the same request", () => {
    fc.assert(
      fc.property(reqArb, (r) => {
        expect(same(canonicalize(r), canonicalize({ ...r }))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("differs whenever any single field differs", () => {
    fc.assert(
      fc.property(reqArb, fc.constantFrom("pin", "action", "ts", "nonce", "payload"), (r, field) => {
        const mutated: CanonicalFields = { ...r };
        if (field === "ts") mutated.ts = r.ts + 1;
        else if (field === "payload") mutated.payload = [r.payload];
        else mutated[field as "pin" | "action" | "nonce"] = r[field as "pin" | "action" | "nonce"] + "x";
        expect(same(canonicalize(r), canonicalize(mutated))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("differs when two arbitrary requests differ in string fields", () => {
    fc.assert(
      fc.property(reqArb, reqArb, (a, b) => {
        fc.pre(a.pin !== b.pin || a.action !== b.action || a.nonce !== b.nonce || a.ts !== b.ts);
        expect(same(canonicalize(a), canonicalize(b))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("does not confuse field boundaries", () => {
    const base = { ts: 1, nonce: "n", payload: null };
    const a = canonicalize({ ...base, pin: "ab", action: "c" });
    const b = canonicalize({ ...base, pin: "a", action: "bc" });
    expect(same(a, b)).toBe(false);
  });

  it("ignores payload object key order", () => {
    const base = { pin: "p", action: "a", ts: 1, nonce: "n" };
    const a = canonicalize({ ...base, payload: { x: 1, y: { b: 2, a: 3 } } });
    const b = canonicalize({ ...base, payload: { y: { a: 3, b: 2 }, x: 1 } });
    expect(same(a, b)).toBe(true);
  });
});
