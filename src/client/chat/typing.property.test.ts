import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TYPING_THROTTLE_MS, createTypingThrottle } from "./typing";

// Feature: pinme-burnable-pin-messenger, Property 23: Typing throttle
// **Validates: Requirements 10.1, 10.2**

type Ev =
  | { kind: "input"; key: string; text: string; dt: number }
  | { kind: "stop"; key: string; dt: number };

const evArb: fc.Arbitrary<Ev> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("input" as const),
      key: fc.constantFrom("c1", "c2"),
      text: fc.oneof(fc.constant(""), fc.string({ minLength: 1, maxLength: 5 })),
      dt: fc.integer({ min: 0, max: 4000 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("stop" as const),
      key: fc.constantFrom("c1", "c2"),
      dt: fc.integer({ min: 0, max: 4000 }),
    }),
  },
);

describe("Property 23: typing throttle", () => {
  it("sends at most one frame per interval per conversation, none for empty input, and resets on empty/stop", () => {
    fc.assert(
      fc.property(fc.array(evArb, { maxLength: 80 }), (events) => {
        const throttle = createTypingThrottle();
        let now = 0;
        // Time of the last frame sent per key since the last reset (empty input or stop).
        const lastSent = new Map<string, number>();
        for (const ev of events) {
          now += ev.dt;
          if (ev.kind === "stop") {
            throttle.stop(ev.key);
            lastSent.delete(ev.key);
            continue;
          }
          const sent = throttle.onInput(ev.key, ev.text, now);
          if (ev.text.length === 0) {
            expect(sent).toBe(false);
            lastSent.delete(ev.key);
            continue;
          }
          const prev = lastSent.get(ev.key);
          if (prev === undefined) {
            // First non-empty input after a reset is sent immediately.
            expect(sent).toBe(true);
          } else if (now - prev < TYPING_THROTTLE_MS) {
            expect(sent).toBe(false);
          } else {
            expect(sent).toBe(true);
          }
          if (sent) lastSent.set(ev.key, now);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("never emits two frames for a conversation within 3 s without an intervening reset", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 100 }), (gaps) => {
        const throttle = createTypingThrottle();
        let now = 0;
        const sentAt: number[] = [];
        for (const g of gaps) {
          now += g;
          if (throttle.onInput("c", "x", now)) sentAt.push(now);
        }
        for (let i = 1; i < sentAt.length; i++) {
          expect(sentAt[i]! - sentAt[i - 1]!).toBeGreaterThanOrEqual(TYPING_THROTTLE_MS);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is independent per conversation", () => {
    const throttle = createTypingThrottle();
    expect(throttle.onInput("a", "x", 0)).toBe(true);
    expect(throttle.onInput("b", "x", 1)).toBe(true);
    expect(throttle.onInput("a", "x", 2)).toBe(false);
  });
});
