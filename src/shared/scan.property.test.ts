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

describe("invite links", () => {
  it("reads a PIN and token from an invite link from any origin, and rejects other paths", async () => {
    const { parseInvite, inviteUrl, newInviteToken } = await import("./scan");
    const token = newInviteToken((n) => new Uint8Array(n).fill(7));
    expect(parseInvite(inviteUrl("https://pinme.example", "2A4F9C1B", token))).toEqual({ pin: "2A4F9C1B", token });
    expect(parseInvite("http://localhost:5173/i/2A4F9C1B")).toEqual({ pin: "2A4F9C1B" });
    expect(parseInvite("https://pinme.example/x/2A4F9C1B")).toBeNull();
    expect(parseInvite("javascript:alert(1)")).toBeNull();
    expect(classifyScan(inviteUrl("https://a.b", "2A4F9C1B", token), ["2A4F9C1B"])).toBe("own-pin");
  });
});
