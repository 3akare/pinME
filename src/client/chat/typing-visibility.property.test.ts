import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TYPING_HIDE_MS, createTypingVisibility, type TypingTimers } from "./typing";

// Feature: pinme-burnable-pin-messenger, Property 24: Typing indicator visibility
// **Validates: Requirements 10.3, 10.4, 10.5**

function fakeClock() {
  let t = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timers: TypingTimers = {
    now: () => t,
    setTimeout: (fn, ms) => {
      jobs.set(++id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (h) => void jobs.delete(h as number),
  };
  return {
    timers,
    now: () => t,
    advance(ms: number) {
      const target = t + ms;
      for (;;) {
        const due = [...jobs].filter(([, j]) => j.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        jobs.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
      }
      t = target;
    },
  };
}

type Ev =
  | { kind: "typing"; key: string }
  | { kind: "message"; key: string }
  | { kind: "tick"; ms: number };

const evArb: fc.Arbitrary<Ev> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("typing" as const), key: fc.constantFrom("a", "b") }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("message" as const), key: fc.constantFrom("a", "b") }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("tick" as const), ms: fc.integer({ min: 0, max: 7000 }) }) },
);

describe("Property 24: typing indicator visibility", () => {
  it("is visible iff a typing frame arrived within the last 5 s with no message since", () => {
    fc.assert(
      fc.property(fc.array(evArb, { maxLength: 60 }), (events) => {
        const clock = fakeClock();
        const visible = new Map<string, boolean>();
        const v = createTypingVisibility((k, vis) => void visible.set(k, vis), clock.timers);
        // Model: time of last typing frame per key; cleared by a message.
        const lastTyping = new Map<string, number>();
        const check = () => {
          for (const key of ["a", "b"]) {
            const at = lastTyping.get(key);
            const expected = at !== undefined && clock.now() - at < TYPING_HIDE_MS;
            expect(visible.get(key) ?? false).toBe(expected);
          }
        };
        for (const ev of events) {
          if (ev.kind === "typing") {
            v.onTyping(ev.key);
            lastTyping.set(ev.key, clock.now());
          } else if (ev.kind === "message") {
            v.onMessage(ev.key);
            lastTyping.delete(ev.key);
          } else {
            clock.advance(ev.ms);
          }
          check();
        }
        v.dispose();
      }),
      { numRuns: 200 },
    );
  });

  it("hides within 500 ms of the 5 s mark and stays visible just before it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 499 }), (slack) => {
        const clock = fakeClock();
        const visible = new Map<string, boolean>();
        const v = createTypingVisibility((k, vis) => void visible.set(k, vis), clock.timers);
        v.onTyping("a");
        expect(visible.get("a")).toBe(true);
        clock.advance(TYPING_HIDE_MS - 1);
        expect(visible.get("a")).toBe(true);
        clock.advance(1 + slack);
        expect(visible.get("a")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
