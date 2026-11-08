import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { advance, type Marker } from "./marker";

const rank: Record<Marker, number> = { clock: 0, D: 1, R: 2 };
const markerArb = fc.constantFrom<Marker>("clock", "D", "R");
const eventArb = fc.constantFrom<Marker>("D", "R");

describe("Property 22: Delivery marker monotonicity", () => {
  /**
   * **Validates: Requirements 8.1, 8.3, 8.5, 8.9, 8.10, 8.11, 12.5**
   */
  it("never decreases and ends at the highest event received", () => {
    fc.assert(
      fc.property(fc.array(eventArb), (events) => {
        let m: Marker = "clock";
        for (const e of events) {
          const next = advance(m, e);
          expect(rank[next]).toBeGreaterThanOrEqual(rank[m]);
          m = next;
        }
        const expected: Marker = events.includes("R")
          ? "R"
          : events.includes("D")
            ? "D"
            : "clock";
        expect(m).toBe(expected);
      }),
    );
  });

  it("is idempotent and order-independent", () => {
    fc.assert(
      fc.property(markerArb, markerArb, (a, b) => {
        expect(advance(advance(a, b), b)).toBe(advance(a, b));
        expect(advance(a, b)).toBe(advance(b, a));
      }),
    );
  });

  it("matches examples", () => {
    expect(advance("R", "D")).toBe("R");
    expect(advance("clock", "D")).toBe("D");
    expect(advance("D", "R")).toBe("R");
  });
});
