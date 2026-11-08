import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { burnPin, type BurnDeps, type BurnRepository } from "./burn";

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

async function signBurn(pin: string) {
  const f = {
    pin,
    action: "burn",
    ts: NOW,
    nonce: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
    payload: {},
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

class FakeRepo implements BurnRepository {
  active = new Set<string>(POOL);
  burned = new Set<string>();
  contacts: [string, string][] = [];
  invites: [string, string][] = [];
  calls = 0;

  constructor(contacts: [number, number][], invites: [number, number][]) {
    this.contacts = contacts.map(([a, b]) => [POOL[a], POOL[b]]);
    this.invites = invites.map(([a, b]) => [POOL[a], POOL[b]]);
  }
  snapshot() {
    return JSON.stringify({
      a: [...this.active].sort(),
      b: [...this.burned].sort(),
      c: this.contacts,
      i: this.invites,
    });
  }
  async burnPin(pin: string) {
    this.calls++;
    if (!this.active.has(pin)) return null;
    this.active.delete(pin);
    this.burned.add(pin);
    const former = this.contacts.map(([a, b]) => (a === pin ? b : b === pin ? a : null)).filter((x): x is string => !!x);
    this.contacts = this.contacts.filter(([a, b]) => a !== pin && b !== pin);
    this.invites = this.invites.filter(([a, b]) => a !== pin && b !== pin);
    return { formerContacts: former };
  }
}

function makeDeps(repo: FakeRepo, log: string[]): BurnDeps {
  const used = new Set<string>();
  return {
    repo,
    mailboxFor: (pin) => ({
      async burn() {
        log.push(`burn:${pin}`);
      },
      async contactBurned(p: string) {
        log.push(`cb:${pin}:${p}`);
      },
    }),
    verify: {
      now: () => NOW,
      lookupKey: async (pin) =>
        keys.has(pin) && (repo.active.has(pin) || repo.burned.has(pin))
          ? { signPublicKey: keys.get(pin)!.pub, burned: repo.burned.has(pin) }
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
const pairs = fc
  .array(fc.tuple(idx, idx), { maxLength: 8 })
  .map((p) => p.filter(([a, b]) => a !== b));

describe("Property 29: burn idempotence", () => {
  /** **Validates: Requirements 13.16** */
  it("repeated burns equal one burn; already-burned burns succeed with no state change", async () => {
    await fc.assert(
      fc.asyncProperty(pairs, pairs, idx, fc.integer({ min: 1, max: 4 }), async (contacts, invites, target, extra) => {
        const pin = POOL[target];
        const repo = new FakeRepo(contacts, invites);
        const log: string[] = [];
        const deps = makeDeps(repo, log);

        const first = await burnPin(deps, await signBurn(pin));
        expect(first).toEqual({ ok: true, value: { pin, alreadyBurned: false } });
        const afterOne = repo.snapshot();
        const logAfterOne = [...log];
        const callsAfterOne = repo.calls;

        for (let i = 0; i < extra; i++) {
          const again = await burnPin(deps, await signBurn(pin)); // fresh nonce each time
          expect(again).toEqual({ ok: true, value: { pin, alreadyBurned: true } });
          expect(repo.snapshot()).toBe(afterOne);
          expect(log).toEqual(logAfterOne);
          expect(repo.calls).toBe(callsAfterOne);
        }
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 13.16** */
  it("ownership proof is still required for an already-burned PIN", async () => {
    const repo = new FakeRepo([], []);
    const log: string[] = [];
    const deps = makeDeps(repo, log);
    await burnPin(deps, await signBurn(POOL[0]));
    const before = repo.snapshot();

    // Signed by a different key
    const forged = { ...(await signBurn(POOL[1])), pin: POOL[0] };
    const res = await burnPin(deps, forged);
    expect(res.ok).toBe(false);

    // Replayed nonce
    const req = await signBurn(POOL[0]);
    expect((await burnPin(deps, req)).ok).toBe(true);
    const replay = await burnPin(deps, req);
    expect(replay.ok).toBe(false);
    expect(repo.snapshot()).toBe(before);
  });
});
