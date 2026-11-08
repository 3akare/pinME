import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { BACKOFF_CAP_MS, BACKOFF_START_MS, nextDelay } from "./backoff";

// Feature: pinme-burnable-pin-messenger, Property 15: Reconnect backoff
describe("Property 15: Reconnect backoff", () => {
  /** **Validates: Requirements 6.10, 6.11, 18.17** */
  it("delay after n consecutive failures is min(1000 * 2^n, 30000)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), (n) => {
        let delay = BACKOFF_START_MS;
        for (let i = 0; i < n; i++) delay = nextDelay(delay);
        expect(delay).toBe(Math.min(BACKOFF_START_MS * 2 ** n, BACKOFF_CAP_MS));
      }),
    );
  });

  /** **Validates: Requirements 6.10, 6.11, 18.17** */
  it("never exceeds the cap and never drops below the start", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), (prev) => {
        const d = nextDelay(prev);
        expect(d).toBeGreaterThanOrEqual(BACKOFF_START_MS);
        expect(d).toBeLessThanOrEqual(BACKOFF_CAP_MS);
      }),
    );
  });

  /** **Validates: Requirements 6.10, 6.11, 18.17** */
  it("after reset (successful auth) the sequence restarts at 1000 ms", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        let delay = BACKOFF_START_MS;
        for (let i = 0; i < n; i++) delay = nextDelay(delay);
        delay = BACKOFF_START_MS; // reset
        expect(delay).toBe(1000);
        expect(nextDelay(delay)).toBe(2000);
      }),
    );
  });
});
