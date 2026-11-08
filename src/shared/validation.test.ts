import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isValidDisplayName,
  isValidPersonalMessage,
  isValidPinLabel,
} from "./validation";

// Feature: pinme-burnable-pin-messenger, Property 3: Text field validation
// **Validates: Requirements 1.2, 1.5, 3.3, 11.2, 11.9**
describe("Property 3: Text field validation", () => {
  const anyString = fc.oneof(
    fc.string({ maxLength: 120 }),
    fc.string({ unit: "grapheme-ascii", maxLength: 120 }),
    fc.array(fc.constantFrom(" ", "\t", "\n", "a", "b"), { maxLength: 120 }).map((a) => a.join("")),
  );

  const trimmedOk = (max: number) => (s: string) => {
    const t = s.trim();
    return t.length >= 1 && t.length <= max;
  };

  it("display name accepted iff trimmed non-empty and <= 32", () => {
    fc.assert(
      fc.property(anyString, (s) => {
        expect(isValidDisplayName(s)).toBe(trimmedOk(32)(s));
      }),
      { numRuns: 200 },
    );
  });

  it("PIN label accepted iff trimmed non-empty and <= 24", () => {
    fc.assert(
      fc.property(anyString, (s) => {
        expect(isValidPinLabel(s)).toBe(trimmedOk(24)(s));
      }),
      { numRuns: 200 },
    );
  });

  it("personal message accepted iff length <= 80 (empty allowed)", () => {
    fc.assert(
      fc.property(anyString, (s) => {
        expect(isValidPersonalMessage(s)).toBe(s.length <= 80);
      }),
      { numRuns: 200 },
    );
  });

  it("boundary examples", () => {
    expect(isValidDisplayName("a".repeat(32))).toBe(true);
    expect(isValidDisplayName("a".repeat(33))).toBe(false);
    expect(isValidDisplayName("   ")).toBe(false);
    expect(isValidPinLabel("a".repeat(24))).toBe(true);
    expect(isValidPinLabel("a".repeat(25))).toBe(false);
    expect(isValidPersonalMessage("")).toBe(true);
    expect(isValidPersonalMessage("a".repeat(80))).toBe(true);
    expect(isValidPersonalMessage("a".repeat(81))).toBe(false);
  });

  it("rejects non-string values", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.boolean()), (v) => {
        expect(isValidDisplayName(v)).toBe(false);
        expect(isValidPinLabel(v)).toBe(false);
        expect(isValidPersonalMessage(v)).toBe(false);
      }),
    );
  });
});
