import fc from "fast-check";
import { beforeAll, describe, it, expect } from "vitest";
import { encrypt, generatePinKeys, ready } from "./index";

describe("Property 17: Nonce freshness", () => {
  beforeAll(async () => {
    await ready();
  });

  /** **Validates: Requirements 7.13** */
  it("encrypting twice with the same keys and plaintext yields different 24-byte nonces", () => {
    const alice = generatePinKeys();
    const bob = generatePinKeys();
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 1024 }), (m) => {
        const a = encrypt(m, bob.box.publicKey, alice.box.privateKey);
        const b = encrypt(m, bob.box.publicKey, alice.box.privateKey);
        expect(a.nonce.length).toBe(24);
        expect(b.nonce.length).toBe(24);
        return !a.nonce.every((byte, i) => byte === b.nonce[i]);
      }),
      { numRuns: 100 },
    );
  });
});
