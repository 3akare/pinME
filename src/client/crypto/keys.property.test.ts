import fc from "fast-check";
import { beforeAll, describe, it } from "vitest";
import { generatePinKeys, ready } from "./index";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("Property 2: Per-PIN key uniqueness", () => {
  beforeAll(async () => {
    await ready();
  });

  /** **Validates: Requirements 2.2** */
  it("all X25519 and Ed25519 keys are pairwise distinct across N generated PINs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), (n) => {
        const all: string[] = [];
        for (let i = 0; i < n; i++) {
          const k = generatePinKeys();
          all.push(
            hex(k.box.publicKey),
            hex(k.box.privateKey),
            hex(k.sign.publicKey),
            hex(k.sign.privateKey),
          );
        }
        // No key value is shared between any two PINs (or between key kinds).
        return new Set(all).size === all.length;
      }),
      { numRuns: 50 },
    );
  });
});
