import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isValidPin } from "./pin";
import { classifyScan } from "./scan";

const pin = fc.stringMatching(/^[0-9A-F]{8}$/);
const anyText = fc.oneof(
  fc.string(),
  pin,
  pin.map((p) => p.toLowerCase()),
  pin.map((p) => `${p} `),
);

describe("Property 9: Scan classification", () => {
  /** **Validates: Requirements 5.3, 5.5, 5.7** */
  it("classifies per validity and own-PIN membership", () => {
    fc.assert(
      fc.property(anyText, fc.array(pin, { maxLength: 5 }), fc.boolean(), (text, own, includeText) => {
        const ownPins = includeText && isValidPin(text) ? [...own, text] : own;
        const result = classifyScan(text, ownPins);
        if (!isValidPin(text)) expect(result).toBe("invalid");
        else if (ownPins.includes(text)) expect(result).toBe("own-pin");
        else expect(result).toBe("accept");
      }),
      { numRuns: 200 },
    );
  });
});
