import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { verifySignedRequest, type NonceStore, type VerifyDeps } from "./signedRequest";

const PIN = "ABCDEF01";
const NOW = 1_700_000_000_000;

async function setup(burned = false) {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pk = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const used = new Set<string>();
  const nonceStore: NonceStore = {
    async claim(pin, nonce) {
      const k = `${pin}:${nonce}`;
      if (used.has(k)) return false;
      used.add(k);
      return true;
    },
  };
  const deps: VerifyDeps = {
    now: () => NOW,
    lookupKey: async (pin) => (pin === PIN ? { signPublicKey: bytesToBase64(pk), burned } : null),
    nonceStore,
  };
  const make = async (over: Record<string, unknown> = {}) => {
    const f = {
      pin: PIN,
      action: "updateProfile",
      ts: NOW,
      nonce: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
      payload: { status: "busy" },
      ...over,
    };
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new Uint8Array(canonicalize(f as never)) as Uint8Array<ArrayBuffer>),
    );
    return { ...f, signature: bytesToBase64(sig) };
  };
  return { deps, make, used };
}

describe("verifySignedRequest", () => {
  it("accepts a valid request and rejects its replay", async () => {
    const { deps, make } = await setup();
    const r = await make();
    expect((await verifySignedRequest(r, deps)).ok).toBe(true);
    expect(await verifySignedRequest(r, deps)).toEqual({ ok: false, error: "replay" });
  });

  it("rejects bad shape, tampering, skew and unknown pin", async () => {
    const { deps, make } = await setup();
    expect(await verifySignedRequest({ pin: "x" }, deps)).toEqual({ ok: false, error: "invalid_signature" });
    const r = await make();
    expect(await verifySignedRequest({ ...r, payload: { status: "available" } }, deps)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
    expect(await verifySignedRequest(await make({ ts: NOW - 61_000 }), deps)).toEqual({
      ok: false,
      error: "expired_timestamp",
    });
    expect(await verifySignedRequest(await make({ pin: "00000000" }), deps)).toEqual({
      ok: false,
      error: "unknown_pin",
    });
  });

  it("does not record the nonce when a check fails", async () => {
    const { deps, make, used } = await setup();
    await verifySignedRequest(await make({ ts: NOW - 61_000 }), deps);
    const r = await make();
    const bad = (r.signature[0] === "A" ? "B" : "A") + r.signature.slice(1);
    expect(await verifySignedRequest({ ...r, signature: bad }, deps)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
    expect(used.size).toBe(0);
  });

  it("burned PIN: burn is a no-op success, other actions unknown_pin", async () => {
    const { deps, make } = await setup(true);
    const burn = await verifySignedRequest(await make({ action: "burn", payload: {} }), deps);
    expect(burn).toMatchObject({ ok: true, alreadyBurned: true });
    expect(await verifySignedRequest(await make(), deps)).toEqual({ ok: false, error: "unknown_pin" });
  });
});
