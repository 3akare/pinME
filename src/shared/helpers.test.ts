import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, decodedLength } from "./base64";
import { advance, type Marker } from "./marker";
import { generatePin, isValidPin, PIN_REGEX } from "./pin";
import {
  isValidDisplayName,
  isValidPersonalMessage,
  isValidPinLabel,
} from "./validation";

const markers = fc.constantFrom<Marker>("clock", "D", "R");

describe("pin", () => {
  it("generates valid PINs", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 4, maxLength: 4 }), (b) => {
        const p = generatePin(() => b);
        expect(p).toHaveLength(8);
        expect(isValidPin(p)).toBe(true);
      }),
    );
  });
  it("isValidPin matches regex", () => {
    fc.assert(fc.property(fc.string(), (s) => isValidPin(s) === PIN_REGEX.test(s)));
    expect(isValidPin("abcdef01")).toBe(false);
    expect(isValidPin("ABCDEF01")).toBe(true);
  });
});

describe("marker", () => {
  it("is the max, commutative-monotone", () => {
    fc.assert(
      fc.property(markers, markers, (a, b) => {
        expect(advance(a, b)).toBe(advance(b, a));
        expect(advance(advance(a, b), b)).toBe(advance(a, b));
      }),
    );
    expect(advance("R", "D")).toBe("R");
    expect(advance("clock", "D")).toBe("D");
  });
});

describe("validation", () => {
  it("name/label/message bounds", () => {
    expect(isValidDisplayName("  ")).toBe(false);
    expect(isValidDisplayName("a".repeat(32))).toBe(true);
    expect(isValidDisplayName("a".repeat(33))).toBe(false);
    expect(isValidPinLabel("a".repeat(24))).toBe(true);
    expect(isValidPinLabel(" " + "a".repeat(25))).toBe(false);
    expect(isValidPersonalMessage("")).toBe(true);
    expect(isValidPersonalMessage("a".repeat(81))).toBe(false);
  });
});

describe("base64", () => {
  it("round trips and reports length", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (b) => {
        const s = bytesToBase64(b);
        expect(Array.from(base64ToBytes(s))).toEqual(Array.from(b));
        expect(decodedLength(s)).toBe(b.length);
      }),
    );
  });
});
