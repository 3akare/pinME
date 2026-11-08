import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { base64ToBytes } from "../../shared/base64";
import { decrypt, encrypt, generatePinKeys, ready } from "../crypto";
import type { ContactRecord, MessageRecord } from "../storage";
import { sendBroadcast, type BroadcastDeps } from "./broadcast";

const OWN = "AAAAAAAA";
let sender: ReturnType<typeof generatePinKeys>;
let pool: ReturnType<typeof generatePinKeys>[];

beforeAll(async () => {
  await ready();
  sender = generatePinKeys();
  pool = Array.from({ length: 250 }, () => generatePinKeys());
});

describe("Property 26: Broadcast construction", () => {
  /** **Validates: Requirements 12.1, 12.2** */
  it("one distinct, decryptable envelope per accepted contact, at most 100 per frame", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 250 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (count, text) => {
          const contacts: ContactRecord[] = pool.slice(0, count).map((k, i) => ({
            ownPin: OWN,
            contactPin: `P${String(i).padStart(7, "0")}`,
            displayName: `c${i}`,
            boxPk: k.box.publicKey,
            signPk: k.sign.publicKey,
            status: "active",
            personalMessage: "",
            unavailable: false,
          })) as ContactRecord[];
          const frames: { type: string; envelopes: any[] }[] = [];
          const deps: BroadcastDeps = {
            repos: {
              pinRepo: { get: async () => ({ pin: OWN, boxSk: sender.box.privateKey }) },
              contactRepo: { listForPin: async () => contacts },
              messageRepo: { put: async (_m: MessageRecord) => {} },
            } as never,
            store: { addMessage: () => {} },
            encrypt,
            send: (d) => (frames.push(JSON.parse(d)), true),
            isConnected: () => true,
          };

          const r = await sendBroadcast(deps, { ownPin: OWN, text });
          expect(r.ok).toBe(true);

          const envs = frames.flatMap((f) => f.envelopes);
          expect(frames.every((f) => f.type === "broadcast" && f.envelopes.length <= 100)).toBe(true);
          expect(envs).toHaveLength(count);
          expect(envs.map((e) => e.to)).toEqual(contacts.map((c) => c.contactPin));
          expect(new Set(envs.map((e) => e.messageId)).size).toBe(count);
          expect(new Set(envs.map((e) => e.nonce)).size).toBe(count);

          envs.forEach((e, i) => {
            const out = decrypt(
              { nonce: base64ToBytes(e.nonce), ciphertext: base64ToBytes(e.ciphertext) },
              sender.box.publicKey,
              pool[i]!.box.privateKey,
            );
            expect(out).toBe(text);
          });
        },
      ),
      { numRuns: 25 },
    );
  });
});
