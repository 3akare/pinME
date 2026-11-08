import { beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { getPrekeys, publishPrekeys, type PrekeyDeps } from "./prekeys";

const ME = "AAAAAAA1";
const NOW = 1_700_000_000_000;
let priv: CryptoKey;
let pub: string;
const key32 = bytesToBase64(new Uint8Array(32).fill(3));
const sig64 = bytesToBase64(new Uint8Array(64).fill(4));

beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  priv = kp.privateKey;
  pub = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
});

async function signed(action: string, payload: unknown) {
  const f = { pin: ME, action, ts: NOW, nonce: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))), payload };
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, priv, new Uint8Array(canonicalize(f as never)) as Uint8Array<ArrayBuffer>));
  return { ...f, signature: bytesToBase64(sig) };
}

function deps(allowed: boolean) {
  const putPrekeys = vi.fn(async () => ({ opkCount: 3 }));
  const takePrekeyBundle = vi.fn(async () => ({ spk: { id: 1, pub: key32, sig: sig64 } }));
  const d: PrekeyDeps = {
    mailboxFor: () => ({ putPrekeys, takePrekeyBundle }),
    mayRelay: async () => allowed,
    verify: { now: () => NOW, lookupKey: async (p) => (p === ME ? { signPublicKey: pub, burned: false } : null), nonceStore: { claim: async () => true } },
  };
  return { d, putPrekeys, takePrekeyBundle };
}

describe("publishPrekeys", () => {
  it("stores well-formed public prekeys for the signer", async () => {
    const t = deps(true);
    const res = await publishPrekeys(t.d, await signed("publishPrekeys", { spk: { id: 5, pub: key32, sig: sig64 }, opks: [{ id: 6, pub: key32 }] }));
    expect(res).toEqual({ ok: true, value: { opkCount: 3 } });
    expect(t.putPrekeys).toHaveBeenCalledWith({ spk: { id: 5, pub: key32, sig: sig64 }, opks: [{ id: 6, pub: key32 }] });
  });

  it("rejects malformed keys, extra fields and oversized uploads", async () => {
    const t = deps(true);
    expect(await publishPrekeys(t.d, await signed("publishPrekeys", { opks: [{ id: 1, pub: "short" }] }))).toMatchObject({ ok: false, field: "opks" });
    expect(await publishPrekeys(t.d, await signed("publishPrekeys", { spk: { id: 1, pub: key32 }, opks: [] }))).toMatchObject({ ok: false, field: "spk" });
    expect(await publishPrekeys(t.d, await signed("publishPrekeys", { opks: [], extra: 1 }))).toMatchObject({ ok: false, field: "payload" });
    const many = Array.from({ length: 51 }, (_, i) => ({ id: i, pub: key32 }));
    expect(await publishPrekeys(t.d, await signed("publishPrekeys", { opks: many }))).toMatchObject({ ok: false, field: "opks" });
    expect(t.putPrekeys).not.toHaveBeenCalled();
  });
});

describe("getPrekeys", () => {
  it("hands a bundle only to a contact or group-mate", async () => {
    const yes = deps(true);
    expect(await getPrekeys(yes.d, await signed("getPrekeys", { pin: "BBBBBBB2" }))).toMatchObject({ ok: true });
    const no = deps(false);
    expect(await getPrekeys(no.d, await signed("getPrekeys", { pin: "BBBBBBB2" }))).toMatchObject({ ok: false, code: "not_a_contact" });
    expect(no.takePrekeyBundle).not.toHaveBeenCalled();
  });
});
