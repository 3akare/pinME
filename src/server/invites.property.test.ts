import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import {
  decideInvite,
  orderPair,
  respondInvite,
  sendInvite,
  type InviteDeps,
  type InviteMailbox,
  type InviteRepository,
} from "./invites";

const NOW = 1_700_000_000_000;
const POOL = ["AAAAAAA1", "BBBBBBB2", "CCCCCCC3", "DDDDDDD4"];
const keys = new Map<string, { priv: CryptoKey; pub: string }>();

beforeAll(async () => {
  for (const pin of POOL) {
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
    keys.set(pin, { priv: kp.privateKey, pub });
  }
});

async function sign(pin: string, action: string, payload: Record<string, unknown>) {
  const f = {
    pin,
    action,
    ts: NOW,
    nonce: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
    payload,
  };
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      keys.get(pin)!.priv,
      new Uint8Array(canonicalize(f as never)) as Uint8Array<ArrayBuffer>,
    ),
  );
  return { ...f, signature: bytesToBase64(sig) };
}

interface State {
  exists: boolean[];
  burned: boolean[];
  invites: [number, number][]; // directed (from, to), unique, from != to
  contacts: [number, number][]; // unordered pairs, unique
}

class FakeRepo implements InviteRepository {
  pins = new Set<string>();
  burnedSet = new Set<string>();
  inv = new Map<string, { fromPin: string; toPin: string }>();
  contactRows: string[] = [];

  constructor(s: State) {
    POOL.forEach((p, i) => {
      if (s.exists[i]) this.pins.add(p);
      if (s.burned[i]) this.burnedSet.add(p);
    });
    for (const [a, b] of s.invites) this.inv.set(crypto.randomUUID(), { fromPin: POOL[a], toPin: POOL[b] });
    for (const [a, b] of s.contacts) this.contactRows.push(orderPair(POOL[a], POOL[b]).join(":"));
  }
  snapshot() {
    return JSON.stringify({
      i: [...this.inv.entries()].sort(),
      c: [...this.contactRows].sort(),
    });
  }
  async pinExists(pin: string) {
    return this.pins.has(pin);
  }
  async isBurned(pin: string) {
    return this.burnedSet.has(pin);
  }
  async linked(a: string, b: string) {
    for (const v of this.inv.values()) {
      if ((v.fromPin === a && v.toPin === b) || (v.fromPin === b && v.toPin === a)) return true;
    }
    return this.contactRows.includes(orderPair(a, b).join(":"));
  }
  async insertInvite(from: string, to: string) {
    const id = crypto.randomUUID();
    this.inv.set(id, { fromPin: from, toPin: to });
    return { id };
  }
  async getInvite(id: string) {
    const v = this.inv.get(id);
    return v ? { id, ...v } : null;
  }
  async acceptInvite(id: string) {
    const v = this.inv.get(id);
    if (!v) return false;
    this.inv.delete(id);
    const row = orderPair(v.fromPin, v.toPin).join(":");
    if (!this.contactRows.includes(row)) this.contactRows.push(row);
    return true;
  }
  async deleteInvite(id: string) {
    return this.inv.delete(id);
  }
}

function makeDeps(repo: FakeRepo): InviteDeps {
  const box: InviteMailbox = {
    async checkInviteQuota() {
      return { ok: true, retryAfterMs: 0 };
    },
    async pushNotice() {
      return undefined;
    },
    invalidatePairs() {},
  };
  const used = new Set<string>();
  return {
    repo,
    mailboxFor: () => box,
    verify: {
      now: () => NOW,
      lookupKey: async (pin) =>
        keys.has(pin) && repo.pins.has(pin) && !repo.burnedSet.has(pin)
          ? { signPublicKey: keys.get(pin)!.pub, burned: false }
          : null,
      nonceStore: {
        async claim(pin, nonce) {
          const k = `${pin}:${nonce}`;
          if (used.has(k)) return false;
          used.add(k);
          return true;
        },
      },
    },
  };
}

const idx = fc.integer({ min: 0, max: POOL.length - 1 });
const pairs = fc.array(fc.tuple(idx, idx), { maxLength: 8 });

const stateArb = fc
  .record({
    exists: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    burned: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    invites: pairs,
    contacts: pairs,
    sender: idx,
    target: fc.oneof(idx.map((i) => POOL[i]), fc.constantFrom("zz", "abcdefgh", "")),
  })
  .map(({ exists, burned, invites, contacts, sender, target }) => {
    exists[sender] = true;
    burned[sender] = false;
    const seenI = new Set<string>();
    const seenC = new Set<string>();
    const state: State = {
      exists,
      burned,
      invites: invites.filter(([a, b]) => {
        const k = `${a}>${b}`;
        if (a === b || seenI.has(k)) return false;
        seenI.add(k);
        return true;
      }),
      contacts: contacts.filter(([a, b]) => {
        const k = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (a === b || seenC.has(k)) return false;
        seenC.add(k);
        return true;
      }),
    };
    return { state, sender: POOL[sender], target };
  });

describe("Property 7: invite decision and state transitions", () => {
  it("decideInvite follows the documented precedence", () => {
    const facts = { senderPin: "AAAAAAA1", target: "BBBBBBB2", targetExists: true, targetBurned: false, linked: false };
    expect(decideInvite(facts)).toBeNull();
    expect(decideInvite({ ...facts, target: "nope" })).toBe("validation_failed");
    expect(decideInvite({ ...facts, targetExists: false })).toBe("not_found");
    expect(decideInvite({ ...facts, targetBurned: true })).toBe("pin_burned");
    expect(decideInvite({ ...facts, target: "AAAAAAA1" })).toBe("self_invite");
    expect(decideInvite({ ...facts, linked: true })).toBe("duplicate");
  });

  /** **Validates: Requirements 4.1, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11** */
  it("sendInvite creates an invite iff allowed; accept yields one contact pair, decline none", async () => {
    await fc.assert(
      fc.asyncProperty(stateArb, fc.boolean(), async ({ state, sender, target }, accept) => {
        const repo = new FakeRepo(state);
        const deps = makeDeps(repo);
        const before = repo.snapshot();

        const expectedError = decideInvite({
          senderPin: sender,
          target,
          targetExists: repo.pins.has(target),
          targetBurned: repo.burnedSet.has(target),
          linked: await repo.linked(sender, target),
        });

        const res = await sendInvite(deps, await sign(sender, "sendInvite", { to: target }));

        if (expectedError) {
          expect(res).toMatchObject({ ok: false, code: expectedError });
          expect(repo.snapshot()).toBe(before);
          return;
        }

        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const created = repo.inv.get(res.value.inviteId);
        expect(created).toEqual({ fromPin: sender, toPin: target });
        expect(repo.inv.size).toBe(state.invites.length + 1);
        expect(repo.contactRows.length).toBe(state.contacts.length);

        const contactsBefore = repo.contactRows.length;
        const resp = await respondInvite(
          deps,
          await sign(target, "respondInvite", { inviteId: res.value.inviteId, accept }),
        );
        expect(resp).toEqual({ ok: true, value: { accepted: accept, contactPin: sender } });
        expect(repo.inv.has(res.value.inviteId)).toBe(false);
        const pairKey = orderPair(sender, target).join(":");
        const pairCount = repo.contactRows.filter((r) => r === pairKey).length;
        if (accept) {
          expect(pairCount).toBe(1);
          expect(repo.contactRows.length).toBe(contactsBefore + 1);
        } else {
          expect(pairCount).toBe(0);
          expect(repo.contactRows.length).toBe(contactsBefore);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("invite link token", () => {
  const fresh = () =>
    new FakeRepo({ exists: [true, true, true, true], burned: [false, false, false, false], invites: [], contacts: [] });

  it("relays a well-formed token to the invited PIN's mailbox", async () => {
    const repo = fresh();
    const deps = makeDeps(repo);
    const pushed: unknown[] = [];
    deps.mailboxFor = () => ({
      checkInviteQuota: async () => ({ ok: true, retryAfterMs: 0 }),
      pushNotice: async (n) => void pushed.push(n),
      invalidatePairs: () => {},
    });
    const token = "abcdefghijklmnopqrstuv";
    const res = await sendInvite(deps, await sign(POOL[0], "sendInvite", { to: POOL[1], token }));
    expect(res.ok).toBe(true);
    expect(pushed[0]).toMatchObject({ kind: "invite", from: POOL[0], token });
  });

  it("rejects a malformed token before anything is written", async () => {
    const repo = fresh();
    const before = repo.snapshot();
    const res = await sendInvite(makeDeps(repo), await sign(POOL[0], "sendInvite", { to: POOL[1], token: "short" }));
    expect(res).toMatchObject({ ok: false, code: "validation_failed", field: "token" });
    expect(repo.snapshot()).toBe(before);
  });
});
