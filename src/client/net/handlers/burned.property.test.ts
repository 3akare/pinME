import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sendMessage } from "../../chat/send";
import type { ContactRecord, MessageRecord, PinRecord } from "../../storage";
import { createDispatcher } from "../dispatch";
import { registerBurnedHandlers } from "./burned";

// Feature: pinme-burnable-pin-messenger, Property 32: Contact marked unavailable on burn
// **Validates: Requirements 13.10, 25.5**

const OWN_POOL = ["A0000001", "A0000002", "A0000003"];
const CONTACT_POOL = ["C0000001", "C0000002", "C0000003", "C0000004"];

const flush = () => new Promise((r) => setTimeout(r, 0));
const key = (o: string, c: string) => `${o}/${c}`;

const stateArb = fc.record({
  // For each own PIN, the subset of the contact pool it has as contacts.
  contacts: fc.tuple(...OWN_POOL.map(() => fc.subarray(CONTACT_POOL))),
  burned: fc.constantFrom(...CONTACT_POOL),
  alreadyUnavailable: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
});

describe("Property 32: contact marked unavailable on burn", () => {
  it("marks the burned contact unavailable for every own PIN, leaves others unchanged, and rejects sends", async () => {
    await fc.assert(
      fc.asyncProperty(stateArb, async ({ contacts, burned, alreadyUnavailable }) => {
        const contactMap = new Map<string, ContactRecord>();
        const pinMap = new Map<string, PinRecord>();
        const messages: MessageRecord[] = [];
        OWN_POOL.forEach((own, i) => {
          pinMap.set(own, {
            pin: own, label: "", boxSk: new Uint8Array(32), boxPk: new Uint8Array(32),
            signSk: new Uint8Array(64), signPk: new Uint8Array(32), status: "active",
            personalMessage: "", createdAt: 0,
          });
          contacts[i]!.forEach((c, j) => {
            contactMap.set(key(own, c), {
              ownPin: own, contactPin: c, displayName: c, boxPk: new Uint8Array(32),
              signPk: new Uint8Array(32), status: "active", personalMessage: "",
              unavailable: c !== burned && (alreadyUnavailable[i * 4 + j] ?? false),
            });
          });
        });
        const before = new Map([...contactMap].map(([k, v]) => [k, { ...v }]));

        const contactRepo = {
          get: async (o: string, c: string) => contactMap.get(key(o, c)),
          listForPin: async (o: string) => [...contactMap.values()].filter((c) => c.ownPin === o),
          put: async (c: ContactRecord) => void contactMap.set(key(c.ownPin, c.contactPin), c),
          delete: async (o: string, c: string) => void contactMap.delete(key(o, c)),
        };
        const storeMap = new Map<string, ContactRecord>();
        const d = createDispatcher();
        for (const own of OWN_POOL) {
          registerBurnedHandlers(d, {
            ownPin: own,
            repos: { contactRepo },
            store: { upsertContact: (c) => void storeMap.set(key(c.ownPin, c.contactPin), c) },
          });
        }

        d.dispatch(JSON.stringify({ type: "contactBurned", pin: burned }));
        await flush();

        for (const [k, prev] of before) {
          const now = contactMap.get(k)!;
          if (prev.contactPin === burned) {
            expect(now.unavailable).toBe(true);
            expect(storeMap.get(k)?.unavailable).toBe(true);
            expect({ ...now, unavailable: prev.unavailable }).toEqual(prev);
          } else {
            expect(now).toEqual(prev);
            expect(storeMap.has(k)).toBe(false);
          }
        }

        // Sending to the burned contact is rejected; nothing is sent or recorded.
        let sent = 0;
        const added: MessageRecord[] = [];
        for (let i = 0; i < OWN_POOL.length; i++) {
          const own = OWN_POOL[i]!;
          if (!contacts[i]!.includes(burned)) continue;
          const res = await sendMessage(
            {
              repos: {
                pinRepo: { get: async (p: string) => pinMap.get(p) } as never,
                contactRepo,
                messageRepo: { put: async (m: MessageRecord) => void messages.push(m) } as never,
              },
              store: { addMessage: (m) => void added.push(m) },
              encrypt: () => ({ nonce: new Uint8Array(24), ciphertext: new Uint8Array(16) }),
              send: () => (sent++, true),
              isConnected: () => true,
            },
            { ownPin: own, contactPin: burned, text: "hi" },
          );
          expect(res.ok).toBe(false);
        }
        expect(sent).toBe(0);
        expect(added).toHaveLength(0);
        expect(messages).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
