import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "../shared/base64";
import type { DirectoryClient, PinRecord } from "./directoryClient";
import { beginConnection, handleUnauthenticated, isExpired, CHALLENGE_TIMEOUT_MS } from "./handshake";

const PIN = "ABCD2345";
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function keyPair() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { priv: kp.privateKey, pubB64: bytesToBase64(pub) };
}

const dir = (record: PinRecord | "throw"): DirectoryClient => ({
  lookupPin: async () => {
    if (record === "throw") throw new Error("down");
    return record;
  },
  isContactPair: async () => false,
  mayRelay: async () => false,
});

async function sign(priv: CryptoKey, challengeB64: string) {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, base64ToBytes(challengeB64) as BufferSource);
  return bytesToBase64(new Uint8Array(sig));
}

// Validates: Requirements 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 15.2
describe("handshake", () => {
  it("rejects unregistered and burned PINs with pin_unavailable and no challenge", async () => {
    for (const rec of [{ state: "unknown" }, { state: "burned" }] as PinRecord[]) {
      const out = await beginConnection(PIN, dir(rec), rand, 0);
      expect(out).toEqual({ kind: "reject", frame: { type: "error", code: "pin_unavailable" } });
    }
  });

  it("fails closed when the Directory is unreachable", async () => {
    const out = await beginConnection(PIN, dir("throw"), rand, 0);
    expect(out.kind).toBe("reject");
  });

  it("issues a 32-byte challenge with a 10 s deadline", async () => {
    const { pubB64 } = await keyPair();
    const out = await beginConnection(PIN, dir({ state: "active", signPublicKey: pubB64, boxPublicKey: "" }), rand, 1000);
    if (out.kind !== "challenge") throw new Error("expected challenge");
    expect(base64ToBytes(out.attachment.challenge)).toHaveLength(32);
    expect(out.attachment.challengeExpiresAt).toBe(1000 + CHALLENGE_TIMEOUT_MS);
    expect(out.attachment.authenticated).toBe(false);
  });

  it("authenticates a valid signature and closes on a bad one", async () => {
    const a = await keyPair();
    const b = await keyPair();
    const d = dir({ state: "active", signPublicKey: a.pubB64, boxPublicKey: "" });
    const out = await beginConnection(PIN, d, rand, 0);
    if (out.kind !== "challenge") throw new Error("expected challenge");
    const good = JSON.stringify({ type: "challengeResponse", signature: await sign(a.priv, out.attachment.challenge) });
    const bad = JSON.stringify({ type: "challengeResponse", signature: await sign(b.priv, out.attachment.challenge) });
    const ok = await handleUnauthenticated(out.attachment, good, d, 5000);
    expect(ok.kind).toBe("authenticated");
    const no = await handleUnauthenticated(out.attachment, bad, d, 5000);
    expect(no.kind).toBe("close");
  });

  it("ignores everything except challengeResponse while unauthenticated", async () => {
    const { pubB64 } = await keyPair();
    const d = dir({ state: "active", signPublicKey: pubB64, boxPublicKey: "" });
    const out = await beginConnection(PIN, d, rand, 0);
    if (out.kind !== "challenge") throw new Error("expected challenge");
    const frames = [
      "not json",
      JSON.stringify({ type: "ping", to: PIN }),
      JSON.stringify({ type: "challengeResponse", signature: "short" }),
      new ArrayBuffer(4),
    ];
    for (const f of frames) {
      expect((await handleUnauthenticated(out.attachment, f, d, 1)).kind).toBe("ignored");
    }
  });

  it("closes a response arriving after the deadline and reports expiry", async () => {
    const a = await keyPair();
    const d = dir({ state: "active", signPublicKey: a.pubB64, boxPublicKey: "" });
    const out = await beginConnection(PIN, d, rand, 0);
    if (out.kind !== "challenge") throw new Error("expected challenge");
    const msg = JSON.stringify({ type: "challengeResponse", signature: await sign(a.priv, out.attachment.challenge) });
    expect((await handleUnauthenticated(out.attachment, msg, d, CHALLENGE_TIMEOUT_MS)).kind).toBe("close");
    expect(isExpired(out.attachment, CHALLENGE_TIMEOUT_MS - 1)).toBe(false);
    expect(isExpired(out.attachment, CHALLENGE_TIMEOUT_MS)).toBe(true);
  });
});
