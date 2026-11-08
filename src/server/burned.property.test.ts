import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesToBase64 } from "../shared/base64";
import { canonicalize } from "../shared/canonical";
import { registerPin, type DirectoryRepository, type PinRecord } from "./directory";
import { orderPair, sendInvite, type InviteDeps, type InviteRepository } from "./invites";

// Feature: pinme-burnable-pin-messenger, Property 30: Burned PIN is unreachable
// **Validates: Requirements 13.5, 13.11, 13.14**

const NOW = 1_700_000_000_000;
const SENDER = "AAAAAAA1";
const HEX = "0123456789ABCDEF".split("");
const pinArb = fc
  .array(fc.constantFrom(...HEX), { minLength: 8, maxLength: 8 })
  .map((a) => a.join(""))
  .filter((p) => p !== SENDER);
const keyB64 = Buffer.alloc(32, 7).toString("base64");

let senderKey: { priv: CryptoKey; pub: string };
beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  senderKey = {
    priv: kp.privateKey,
    pub: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))),
  };
});

async function signInvite(to: string) {
  const f = {
    pin: SENDER,
    action: "sendInvite",
    ts: NOW,
    nonce: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
    payload: { to },
  };
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      senderKey.priv,
      new Uint8Array(canonicalize(f as never)) as Uint8Array<ArrayBuffer>,
    ),
  );
  return { ...f, signature: bytesToBase64(sig) };
}

describe("Property 30: burned PIN is unreachable (server layer)", () => {
  it("registerPin rejects a burned PIN and leaves the directory unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(pinArb, async (pin) => {
        const pins = new Map<string, PinRecord>();
        const burned = new Set<string>([pin]);
        const repo: DirectoryRepository = {
          getPin: async (p) => pins.get(p) ?? null,
          isBurned: async (p) => burned.has(p),
          insertPin: async (r) => {
            if (pins.has(r.pin)) return false;
            pins.set(r.pin, r);
            return true;
          },
        };
        const res = await registerPin(repo, {
          pin,
          boxPublicKey: keyB64,
          signPublicKey: keyB64,
          displayName: "x",
          status: "available",
          personalMessage: "",
        });
        expect(res.ok).toBe(false);
        expect(pins.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("sendInvite to a burned PIN returns pin_burned, even if it was a contact or had a pending invite", async () => {
    await fc.assert(
      fc.asyncProperty(pinArb, fc.boolean(), fc.boolean(), fc.boolean(), async (target, wasContact, hadInvite, stillExists) => {
        const contacts = new Set<string>(wasContact ? [orderPair(SENDER, target).join(":")] : []);
        let inserted = 0;
        const repo: InviteRepository = {
          pinExists: async () => stillExists,
          isBurned: async (p) => p === target,
          linked: async (a, b) => contacts.has(orderPair(a, b).join(":")) || (hadInvite && b === target),
          insertInvite: async () => {
            inserted++;
            return { id: "x" };
          },
          getInvite: async () => null,
          acceptInvite: async () => false,
          deleteInvite: async () => false,
        };
        const used = new Set<string>();
        let notices = 0;
        const deps: InviteDeps = {
          repo,
          mailboxFor: () => ({
            checkInviteQuota: async () => ({ ok: true, retryAfterMs: 0 }),
            pushNotice: async () => void notices++,
            invalidatePairs() {},
          }),
          verify: {
            now: () => NOW,
            lookupKey: async (pin) => (pin === SENDER ? { signPublicKey: senderKey.pub, burned: false } : null),
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
        const res = await sendInvite(deps, await signInvite(target));
        expect(res).toMatchObject({ ok: false, code: "pin_burned" });
        expect(inserted).toBe(0);
        expect(notices).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
