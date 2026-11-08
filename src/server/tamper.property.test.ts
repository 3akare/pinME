import { beforeAll, describe, it, expect } from "vitest";
import fc from "fast-check";
import * as cm from "../client/crypto";
import { bytesToBase64 } from "../shared/base64";
import { SIGNED_ACTIONS } from "../shared/signed";
import { verifySignedRequest, type NonceStore, type VerifyDeps } from "./signedRequest";

// Feature: pinme-burnable-pin-messenger, Property 38: Tamper detection
// **Validates: Requirements 19.8**

const NOW = 1_700_000_000_000;

const pinArb = fc.stringMatching(/^[0-9A-F]{8}$/);
const actionArb = fc.constantFrom(...SIGNED_ACTIONS);
const tsArb = fc.integer({ min: NOW - 30_000, max: NOW + 30_000 });
const nonceArb = fc
  .uint8Array({ minLength: 16, maxLength: 32 })
  .map((b) => bytesToBase64(b));
const payloadArb = fc.oneof(
  fc.constant(null),
  fc.record({ v: fc.string({ maxLength: 20 }) }),
  fc.record({ n: fc.integer({ min: 0, max: 1000 }) }),
);
const fieldArb = fc.constantFrom("pin", "action", "ts", "nonce", "payload");

beforeAll(async () => {
  await cm.ready();
});

describe("Property 38: tamper detection", () => {
  it("rejects a validly signed request after any single field is modified", async () => {
    const keys = cm.generatePinKeys();
    const signPk = bytesToBase64(keys.sign.publicKey);

    await fc.assert(
      fc.asyncProperty(
        pinArb,
        actionArb,
        tsArb,
        nonceArb,
        payloadArb,
        fieldArb,
        pinArb,
        actionArb,
        tsArb,
        nonceArb,
        payloadArb,
        async (pin, action, ts, nonce, payload, field, pin2, action2, ts2, nonce2, payload2) => {
          const orig = { pin, action, ts, nonce, payload };
          const alt = { pin: pin2, action: action2, ts: ts2, nonce: nonce2, payload: payload2 };
          // Require the replacement to actually differ.
          fc.pre(JSON.stringify(orig[field as keyof typeof orig]) !== JSON.stringify(alt[field as keyof typeof alt]));

          const signature = bytesToBase64(cm.signRequest(orig as never, keys.sign.privateKey));
          const used = new Set<string>();
          const nonceStore: NonceStore = {
            async claim(p, n) {
              const k = `${p}:${n}`;
              if (used.has(k)) return false;
              used.add(k);
              return true;
            },
          };
          // Same key for every PIN so rejection is attributable to the signature.
          const deps: VerifyDeps = {
            now: () => NOW,
            lookupKey: async () => ({ signPublicKey: signPk, burned: false }),
            nonceStore,
          };

          // Sanity: the untampered request verifies.
          const good = await verifySignedRequest({ ...orig, signature }, { ...deps, nonceStore: { claim: async () => true } });
          expect(good.ok).toBe(true);

          const tampered = { ...orig, [field]: alt[field as keyof typeof alt], signature };
          const res = await verifySignedRequest(tampered, deps);
          expect(res.ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
