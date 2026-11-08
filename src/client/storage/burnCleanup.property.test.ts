import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { openLocalStore } from "./index";
import { cleanupBurnedPin } from "./burnCleanup";

let n = 0;

const pinArb = fc.stringMatching(/^[A-Z0-9]{1,4}$/);

describe("Property 31: Local burn cleanup is scoped", () => {
  /**
   * **Validates: Requirements 13.8**
   */
  it("removes all data of the burned PIN and leaves other PINs unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(pinArb, { minLength: 2, maxLength: 4 }),
        fc.uniqueArray(pinArb, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 3 }),
        fc.nat(),
        async (pins, peers, perPeer, pick) => {
          const store = await openLocalStore(`prop31-${n++}`);
          try {
            for (const own of pins) {
              await store.pinRepo.put({
                pin: own,
                label: "L",
                boxSk: new Uint8Array([1]),
                boxPk: new Uint8Array([2]),
                signSk: new Uint8Array([3]),
                signPk: new Uint8Array([4]),
                status: "active",
                personalMessage: "",
                createdAt: 1,
              });
              for (const peer of peers) {
                await store.contactRepo.put({
                  ownPin: own,
                  contactPin: peer,
                  displayName: peer,
                  boxPk: new Uint8Array([1]),
                  signPk: new Uint8Array([2]),
                  status: "active",
                  personalMessage: "",
                  unavailable: false,
                });
                await store.inviteRepo.put({
                  inviteId: `${own}-${peer}`,
                  ownPin: own,
                  fromPin: peer,
                  createdAt: 1,
                });
                for (let i = 0; i < perPeer; i++) {
                  await store.messageRepo.put({
                    ownPin: own,
                    contactPin: peer,
                    messageId: `m${i}`,
                    direction: "in",
                    text: `${own}${peer}${i}`,
                    ts: i,
                    kind: "chat",
                  });
                }
              }
            }

            const burned = pins[pick % pins.length]!;
            const snapshot = async () => ({
              pins: await store.db.getAll("pins"),
              contacts: await store.db.getAll("contacts"),
              invites: await store.db.getAll("invites"),
              messages: await store.db.getAll("messages"),
            });
            const before = await snapshot();

            await cleanupBurnedPin(store, burned);

            const after = await snapshot();
            expect(after.pins.some((r) => r.pin === burned)).toBe(false);
            expect(after.contacts.some((r) => r.ownPin === burned)).toBe(false);
            expect(after.invites.some((r) => r.ownPin === burned)).toBe(false);
            expect(after.messages.some((r) => r.ownPin === burned)).toBe(false);

            expect(after.pins).toEqual(before.pins.filter((r) => r.pin !== burned));
            expect(after.contacts).toEqual(before.contacts.filter((r) => r.ownPin !== burned));
            expect(after.invites).toEqual(before.invites.filter((r) => r.ownPin !== burned));
            expect(after.messages).toEqual(before.messages.filter((r) => r.ownPin !== burned));
          } finally {
            store.close();
          }
        },
      ),
      { numRuns: 25 },
    );
  }, 60_000);
});
