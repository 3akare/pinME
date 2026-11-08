import { beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { MAX_GROUP_MEMBERS } from "../shared/limits";
import { createGroup, leaveGroup, type GroupDeps, type GroupRepository } from "./groups";

const ME = "AAAAAAA1";
const G = "11111111-1111-4111-8111-111111111111";
const NOW = 1_700_000_000_000;
let priv: CryptoKey;
let pub: string;

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

function deps(contacts: string[]) {
  const rows = new Map<string, string[]>();
  const repo: GroupRepository = {
    contactsOf: async (_p, others) => others.filter((o) => contacts.includes(o)),
    create: async (id, _by, members) => (rows.has(id) ? false : (rows.set(id, members), true)),
    members: async (id) => rows.get(id) ?? [],
    leave: async (id, pin) => (rows.set(id, (rows.get(id) ?? []).filter((p) => p !== pin)), true),
  };
  const invalidatePairs = vi.fn();
  const d: GroupDeps = {
    repo,
    mailboxFor: () => ({ invalidatePairs }),
    verify: { now: () => NOW, lookupKey: async (p) => (p === ME ? { signPublicKey: pub, burned: false } : null), nonceStore: { claim: async () => true } },
  };
  return { d, rows, invalidatePairs };
}

describe("createGroup", () => {
  it("creates a group of the signer's contacts and refreshes every member's relay cache", async () => {
    const t = deps(["BBBBBBB2", "CCCCCCC3"]);
    expect(await createGroup(t.d, await signed("createGroup", { groupId: G, members: ["BBBBBBB2", "CCCCCCC3"] }))).toEqual({
      ok: true,
      value: { groupId: G, members: [ME, "BBBBBBB2", "CCCCCCC3"] },
    });
    expect(t.invalidatePairs).toHaveBeenCalledTimes(3);
  });

  it("refuses strangers, oversized groups, self, duplicates and repeats", async () => {
    const t = deps(["BBBBBBB2"]);
    expect(await createGroup(t.d, await signed("createGroup", { groupId: G, members: ["BBBBBBB2", "DDDDDDD4"] }))).toMatchObject({ ok: false, code: "not_a_contact" });
    const many = Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => `B${String(i).padStart(7, "0")}`);
    expect(await createGroup(t.d, await signed("createGroup", { groupId: G, members: many }))).toMatchObject({ ok: false, field: "members" });
    expect(await createGroup(t.d, await signed("createGroup", { groupId: G, members: [ME] }))).toMatchObject({ ok: false, field: "members" });
    expect(await createGroup(t.d, await signed("createGroup", { groupId: G, members: ["BBBBBBB2", "BBBBBBB2"] }))).toMatchObject({ ok: false, field: "members" });
    expect((await createGroup(t.d, await signed("createGroup", { groupId: G, members: ["BBBBBBB2"] }))).ok).toBe(true);
    expect(await createGroup(t.d, await signed("createGroup", { groupId: G, members: ["BBBBBBB2"] }))).toMatchObject({ ok: false, code: "duplicate" });
    expect(t.rows.size).toBe(1);
  });
});

describe("leaveGroup", () => {
  it("removes only the signer, and only from a group they are in", async () => {
    const t = deps(["BBBBBBB2"]);
    await createGroup(t.d, await signed("createGroup", { groupId: G, members: ["BBBBBBB2"] }));
    expect(await leaveGroup(t.d, await signed("leaveGroup", { groupId: G }))).toEqual({ ok: true, value: { left: true } });
    expect(t.rows.get(G)).toEqual(["BBBBBBB2"]);
    expect(await leaveGroup(t.d, await signed("leaveGroup", { groupId: G }))).toMatchObject({ ok: false, code: "not_found" });
  });
});
