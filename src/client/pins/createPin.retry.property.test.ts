import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createPin, PinCreationError, type CreatePinDeps } from "./createPin";
import type { PinRecord } from "../storage";

// Feature: pinme-burnable-pin-messenger, Property 5: Registration retry bound
describe("Property 5: Registration retry bound", () => {
  it("makes at most 6 attempts, stores iff one of the first 6 succeeds, nothing when all collide", async () => {
    // **Validates: Requirements 2.5, 2.6**
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20 }), async (k) => {
        const saved: PinRecord[] = [];
        let attempts = 0;
        let ctr = 0;
        const deps: CreatePinDeps = {
          randomBytes: (n) => new Uint8Array(n).fill(++ctr % 256),
          generatePinKeys: () => ({
            box: { publicKey: new Uint8Array(32).fill(1), privateKey: new Uint8Array(32).fill(2) },
            sign: { publicKey: new Uint8Array(32).fill(3), privateKey: new Uint8Array(64).fill(4) },
          }),
          registerPin: async () => {
            attempts++;
            return attempts <= k ? { ok: false, code: "collision" } : { ok: true };
          },
          savePin: async (r) => void saved.push(r),
        };

        const expectedAttempts = Math.min(k, 5) + 1;
        let threw: unknown;
        try {
          await createPin(deps, { displayName: "Ann", label: "Main" });
        } catch (e) {
          threw = e;
        }

        expect(attempts).toBe(expectedAttempts);
        expect(attempts).toBeLessThanOrEqual(6);
        if (k <= 5) {
          expect(threw).toBeUndefined();
          expect(saved).toHaveLength(1);
        } else {
          expect(threw).toBeInstanceOf(PinCreationError);
          expect(saved).toHaveLength(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
