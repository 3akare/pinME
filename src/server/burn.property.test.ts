import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { burnPin, type BurnDeps, type BurnRepository } from "./burn";

const NOW = 1_700_000_000_000;
const POOL = ["AAAAAAA1", "BBBBBBB2", "CCCCCCC3", "DDDDDDD4", "EEEEEEE5"];
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

const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

class FakeRepo implements BurnRepository {
  pins = new Map<string, string>();
  burned = new Map<string, string>();
  invites: { from: string; to: string }[] = [];
  contacts = new Set<string>(); // "low:high" over POOL pins

  async burnPin(pin: string) {
    const k = this.pins.get(pin);
    if (k === undefined) return null;
    this.pins.delete(pin);
    this.burned.set(pin, k);
    const formerContacts: string[] = [];
    for (const c of [...this.contacts]) {
      const [a, b] = c.split(":");
      if (a === pin || b === pin) {
        formerContacts.push(a === pin ? b : a);
        this.contacts.delete(c);
      }
    }
    this.invites = this.invites.filter((i) => i.from !== pin && i.to !== pin);
    return { formerContacts };
  }
}

const idx = fc.integer({ min: 0, max: POOL.length - 1 });
const pairs = fc.array(fc.tuple(idx, idx), { maxLength: 10 });

const stateArb = fc
  .record({ exists: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }), invites: pairs, contacts: pairs, victim: idx })
  .map(({ exists, invites, contacts, victim }) => {
    exists[victim] = true;
    const seenC = new Set<string>();
    return {
      exists,
      victim: POOL[victim],
      invites: invites.filter(([a, b]) => a !== b).map(([a, b]) => ({ from: POOL[a], to: POOL[b] })),
      contacts: contacts
        .filter(([a, b]) => {
          const k = key(a, b);
          if (a === b || seenC.has(k)) return false;
          seenC.add(k);
          return true;
        })
        .map(([a, b]) => key(POOL[a] === POOL[b] ? a : Math.min(a, b), Math.max(a, b))),
    };
  });

describe("Property 28: burn directory effects", () => {
  /** **Validates: Requirements 13.4, 13.6, 13.9, 13.15** */
  it("burn moves the PIN to burned_pins, removes its links, leaves others, notifies each former contact once", async () => {
    await fc.assert(
      fc.asyncProperty(stateArb, async (s) => {
        const repo = new FakeRepo();
        POOL.forEach((p, i) => {
          if (s.exists[i]) repo.pins.set(p, keys.get(p)!.pub);
        });
        repo.invites = s.invites.map((i) => ({ ...i }));
        // contacts were stored as index keys; convert to PIN-based "a:b" strings
        for (const c of s.contacts) {
          const [a, b] = c.split(":").map(Number);
          repo.contacts.add(`${POOL[a]}:${POOL[b]}`);
        }
        const P = s.victim;
        const othersBefore = new Map([...repo.pins].filter(([p]) => p !== P));
        const burnedBefore = new Map(repo.burned);
        const contactsBefore = [...repo.contacts];
        const invitesBefore = repo.invites.map((i) => ({ ...i }));
        const expectedFormer = contactsBefore
          .map((c) => c.split(":"))
          .filter(([a, b]) => a === P || b === P)
          .map(([a, b]) => (a === P ? b : a))
          .sort();

        const notices = new Map<string, string[]>();
        let burnCalls = 0;
        const deps: BurnDeps = {
          repo,
          mailboxFor: (pin) => ({
            async burn() {
              expect(pin).toBe(P);
              burnCalls++;
            },
            async contactBurned(p: string) {
              notices.set(pin, [...(notices.get(pin) ?? []), p]);
            },
          }),
          verify: {
            now: () => NOW,
            lookupKey: async (pin) =>
              repo.pins.has(pin)
                ? { signPublicKey: repo.pins.get(pin)!, burned: false }
                : repo.burned.has(pin)
                  ? { signPublicKey: repo.burned.get(pin)!, burned: true }
                  : null,
            nonceStore: { claim: async () => true },
          },
        };

        const res = await burnPin(deps, await sign(P, "burn", {}));
        expect(res).toEqual({ ok: true, value: { pin: P, alreadyBurned: false } });

        // P moved from pins to burned_pins
        expect(repo.pins.has(P)).toBe(false);
        expect(repo.burned.has(P)).toBe(true);
        expect(burnedBefore.has(P)).toBe(false);
        expect(burnCalls).toBe(1);

        // No invite or contact involves P
        expect(repo.invites.some((i) => i.from === P || i.to === P)).toBe(false);
        expect([...repo.contacts].some((c) => c.split(":").includes(P))).toBe(false);

        // Other PIN rows unchanged; unrelated links unchanged (and no new linkage data)
        expect(new Map(repo.pins)).toEqual(othersBefore);
        expect(repo.invites).toEqual(invitesBefore.filter((i) => i.from !== P && i.to !== P));
        expect([...repo.contacts]).toEqual(contactsBefore.filter((c) => !c.split(":").includes(P)));
        expect(new Map([...repo.burned].filter(([p]) => p !== P))).toEqual(burnedBefore);

        // Each former contact gets exactly one contactBurned(P); nobody else gets any
        expect([...notices.keys()].sort()).toEqual(expectedFormer);
        for (const list of notices.values()) expect(list).toEqual([P]);
      }),
      { numRuns: 100 },
    );
  });
});
