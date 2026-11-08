// Feature: pinme-burnable-pin-messenger, Property 37: Signed request verification outcome
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { SIGNED_ACTIONS } from "../shared/signed";
import { verifySignedRequest, type NonceStore, type VerifyDeps } from "./signedRequest";

const PIN = "ABCDEF01";
const NOW = 1_700_000_000_000;

let kp: CryptoKeyPair;
let pkB64: string;

beforeAll(async () => {
  kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  pkB64 = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
});

async function sign(fields: Record<string, unknown>): Promise<string> {
  const bytes = new Uint8Array(canonicalize(fields as never)) as Uint8Array<ArrayBuffer>;
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, bytes)));
}

const scenario = fc.record({
  pinState: fc.constantFrom("active", "burned", "unknown"),
  action: fc.constantFrom(...SIGNED_ACTIONS),
  skew: fc.oneof(
    fc.integer({ min: -120_000, max: 120_000 }),
    fc.constantFrom(-60_000, 60_000, -60_001, 60_001, 0),
  ),
  nonceUsed: fc.boolean(),
  sigValid: fc.boolean(),
  nonceBytes: fc.uint8Array({ minLength: 16, maxLength: 32 }),
  status: fc.constantFrom("available", "busy", "away"),
});

describe("Property 37: signed request verification outcome", () => {
  it("accepts iff all checks pass; otherwise the right category and no state change", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const nonce = bytesToBase64(s.nonceBytes);
        const fields = {
          pin: PIN,
          action: s.action,
          ts: NOW + s.skew,
          nonce,
          payload: { status: s.status },
        };
        const signature = await sign(fields);
        const request = s.sigValid
          ? { ...fields, signature }
          : { ...fields, payload: { status: s.status + "x" }, signature };

        const used = new Set<string>();
        if (s.nonceUsed) used.add(`${PIN}:${nonce}`);
        const before = new Set(used);
        const nonceStore: NonceStore = {
          async claim(pin, n) {
            const k = `${pin}:${n}`;
            if (used.has(k)) return false;
            used.add(k);
            return true;
          },
        };
        const deps: VerifyDeps = {
          now: () => NOW,
          lookupKey: async (pin) =>
            pin === PIN && s.pinState !== "unknown"
              ? { signPublicKey: pkB64, burned: s.pinState === "burned" }
              : null,
          nonceStore,
        };

        const result = await verifySignedRequest(request, deps);

        const unknownPin = s.pinState === "unknown" || (s.pinState === "burned" && s.action !== "burn");
        const expired = Math.abs(s.skew) > 60_000;
        let expected: string;
        if (unknownPin) expected = "unknown_pin";
        else if (expired) expected = "expired_timestamp";
        else if (!s.sigValid) expected = "invalid_signature";
        else if (s.nonceUsed) expected = "replay";
        else expected = "ok";

        if (expected === "ok") {
          expect(result.ok).toBe(true);
          expect(used.has(`${PIN}:${nonce}`)).toBe(true);
          // replaying the accepted request is rejected
          expect(await verifySignedRequest(request, deps)).toEqual({ ok: false, error: "replay" });
        } else {
          expect(result).toEqual({ ok: false, error: expected });
          expect(used).toEqual(before);
        }
      }),
      { numRuns: 100 },
    );
  });
});
