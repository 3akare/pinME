import fc from "fast-check";
import { beforeAll, describe, it } from "vitest";
import { verifyEd25519 } from "../../shared/ed25519";
import { generatePinKeys, ready, signChallenge } from "./index";

const challengeArb = fc.uint8Array({ minLength: 1, maxLength: 64 });

describe("Property 13: Challenge signature verification", () => {
  beforeAll(async () => {
    await ready();
  });

  /** **Validates: Requirements 6.4, 6.5, 6.6** */
  it("valid signature verifies; different challenge, modified signature or different key fails", async () => {
    await fc.assert(
      fc.asyncProperty(
        challengeArb,
        challengeArb,
        fc.integer({ min: 0, max: 63 }),
        fc.integer({ min: 0, max: 7 }),
        async (challenge, other, byteIdx, bit) => {
          const k = generatePinKeys().sign;
          const sig = signChallenge(challenge, k.privateKey);

          if (!(await verifyEd25519(k.publicKey, challenge, sig))) return false;

          const same =
            other.length === challenge.length && other.every((v, i) => v === challenge[i]);
          if (!same && (await verifyEd25519(k.publicKey, other, sig))) return false;

          const bad = new Uint8Array(sig);
          bad[byteIdx] ^= 1 << bit;
          if (await verifyEd25519(k.publicKey, challenge, bad)) return false;

          const k2 = generatePinKeys().sign;
          if (await verifyEd25519(k2.publicKey, challenge, sig)) return false;

          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
