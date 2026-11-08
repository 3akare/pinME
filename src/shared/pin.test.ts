import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generatePin, isValidPin, PIN_REGEX } from "./pin";

describe("Property 1: PIN generation format", () => {
  /** **Validates: Requirements 2.1, 4.7** */
  it("generated PINs are 8 chars of 0-9A-F and valid", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 4, maxLength: 4 }), (bytes) => {
        const pin = generatePin(() => bytes);
        expect(pin).toHaveLength(8);
        expect(pin).toMatch(/^[0-9A-F]{8}$/);
        expect(isValidPin(pin)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 2.1, 4.7** */
  it("isValidPin accepts a string iff it matches ^[0-9A-F]{8}$", () => {
    const hexish = fc.stringMatching(/^[0-9A-Fa-f]{0,10}$/);
    fc.assert(
      fc.property(fc.oneof(fc.string(), hexish), (s) => {
        expect(isValidPin(s)).toBe(PIN_REGEX.test(s));
        expect(isValidPin(s)).toBe(/^[0-9A-F]{8}$/.test(s));
      }),
      { numRuns: 200 },
    );
  });

  it("rejects non-string values", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined)), (v) => {
        expect(isValidPin(v)).toBe(false);
      }),
    );
  });
});
