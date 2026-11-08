import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";
import { verifyEd25519, verifyEd25519Base64 } from "./ed25519";

async function makeSigned(msg: Uint8Array) {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, msg as BufferSource));
  return { pub, sig };
}

describe("verifyEd25519", () => {
  const msg = new TextEncoder().encode("hello pinme");

  it("accepts a valid signature", async () => {
    const { pub, sig } = await makeSigned(msg);
    expect(await verifyEd25519(pub, msg, sig)).toBe(true);
    expect(await verifyEd25519Base64(bytesToBase64(pub), msg, bytesToBase64(sig))).toBe(true);
  });

  it("rejects tampered message, tampered signature and bad lengths", async () => {
    const { pub, sig } = await makeSigned(msg);
    expect(await verifyEd25519(pub, new TextEncoder().encode("other"), sig)).toBe(false);
    const bad = sig.slice();
    bad[0] ^= 1;
    expect(await verifyEd25519(pub, msg, bad)).toBe(false);
    expect(await verifyEd25519(pub.slice(0, 31), msg, sig)).toBe(false);
    expect(await verifyEd25519(pub, msg, sig.slice(0, 63))).toBe(false);
    expect(await verifyEd25519Base64("!!!", msg, "???")).toBe(false);
  });
});
