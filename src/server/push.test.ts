import { beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { registerPush, type PushDeps } from "./push";

const PIN = "AAAAAAA1";
const NOW = 1_700_000_000_000;
let priv: CryptoKey;
let pub: string;

beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  priv = kp.privateKey;
  pub = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
});

async function signed(payload: unknown, action = "registerPush") {
  const f = { pin: PIN, action, ts: NOW, nonce: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))), payload };
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, priv, new Uint8Array(canonicalize(f as never)) as Uint8Array<ArrayBuffer>),
  );
  return { ...f, signature: bytesToBase64(sig) };
}

function deps() {
  const setPushEndpoint = vi.fn(async () => ({ ok: true }));
  const d: PushDeps = {
    mailboxFor: () => ({ setPushEndpoint }),
    verify: {
      now: () => NOW,
      lookupKey: async (pin) => (pin === PIN ? { signPublicKey: pub, burned: false } : null),
      nonceStore: { claim: async () => true },
    },
  };
  return { d, setPushEndpoint };
}

describe("registerPush", () => {
  it("stores a valid endpoint for the signing PIN, and null turns it off", async () => {
    const t = deps();
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(await registerPush(t.d, await signed({ endpoint }))).toEqual({ ok: true, value: { registered: true } });
    expect(await registerPush(t.d, await signed({ endpoint: null }))).toEqual({ ok: true, value: { registered: false } });
    expect(t.setPushEndpoint.mock.calls).toEqual([[endpoint], [null]]);
  });

  it("rejects other hosts, extra fields, other actions and bad signatures without touching the mailbox", async () => {
    const t = deps();
    expect(await registerPush(t.d, await signed({ endpoint: "https://evil.example/x" }))).toMatchObject({ ok: false, field: "endpoint" });
    expect(await registerPush(t.d, await signed({ endpoint: null, extra: 1 }))).toMatchObject({ ok: false, field: "payload" });
    expect(await registerPush(t.d, await signed({ endpoint: null }, "updateProfile"))).toMatchObject({ ok: false, code: "invalid_signature" });
    const tampered = { ...(await signed({ endpoint: null })), payload: { endpoint: "https://fcm.googleapis.com/x" } };
    expect(await registerPush(t.d, tampered)).toMatchObject({ ok: false, code: "invalid_signature" });
    expect(t.setPushEndpoint).not.toHaveBeenCalled();
  });
});
