import fc from "fast-check";
import { beforeAll, describe, it } from "vitest";
import { decrypt, encrypt, generatePinKeys, ready } from "./index";

describe("Property 16: Encryption round trip", () => {
  beforeAll(async () => {
    await ready();
  });

  // Valid Unicode text (no lone surrogates) so UTF-8 round trips exactly.
  const plaintext = fc.oneof(
    fc.string({ minLength: 1, maxLength: 4096 }),
    fc.string({ unit: "binary", minLength: 1, maxLength: 4096 }),
    fc.string({ unit: "grapheme", minLength: 1, maxLength: 512 }),
  );

  /** **Validates: Requirements 7.1, 7.7, 7.12** */
  it("decrypt(encrypt(m)) with the matching key pair returns m", () => {
    const alice = generatePinKeys();
    const bob = generatePinKeys();
    fc.assert(
      fc.property(plaintext, (m) => {
        const env = encrypt(m, bob.box.publicKey, alice.box.privateKey);
        return decrypt(env, alice.box.publicKey, bob.box.privateKey) === m;
      }),
      { numRuns: 100 },
    );
  });
});
