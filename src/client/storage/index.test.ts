import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import { openLocalStore, type LocalStore, type PinRecord } from "./index";

let n = 0;
let store: LocalStore;

const pinRec = (pin: string): PinRecord => ({
  pin,
  label: "Main",
  boxSk: new Uint8Array([1]),
  boxPk: new Uint8Array([2]),
  signSk: new Uint8Array([3]),
  signPk: new Uint8Array([4]),
  status: "active",
  personalMessage: "",
  createdAt: 1,
});

async function seed(own: string, other: string) {
  await store.pinRepo.put(pinRec(own));
  await store.contactRepo.put({
    ownPin: own,
    contactPin: other,
    displayName: "c",
    boxPk: new Uint8Array([1]),
    signPk: new Uint8Array([2]),
    status: "active",
    personalMessage: "",
    unavailable: false,
  });
  await store.inviteRepo.put({ inviteId: `i-${own}`, ownPin: own, fromPin: other, createdAt: 1 });
  await store.messageRepo.put({
    ownPin: own,
    contactPin: other,
    messageId: `m-${own}`,
    direction: "in",
    text: "hi",
    ts: 5,
    kind: "chat",
  });
}

beforeEach(async () => {
  store = await openLocalStore(`test-${n++}`);
});

describe("Local_Store", () => {
  it("round-trips identity and orders conversation by ts", async () => {
    await store.identityRepo.put({ displayName: "Ann" });
    expect((await store.identityRepo.get())?.displayName).toBe("Ann");
    for (const [id, ts] of [["a", 3], ["b", 1], ["c", 2]] as const) {
      await store.messageRepo.put({
        ownPin: "P", contactPin: "Q", messageId: id, direction: "out", text: id, ts, kind: "chat",
      });
    }
    const list = await store.messageRepo.listConversation("P", "Q");
    expect(list.map((m) => m.messageId)).toEqual(["b", "c", "a"]);
    await store.messageRepo.setMarker("P", "Q", "a", "D");
    expect((await store.messageRepo.get("P", "Q", "a"))?.marker).toBe("D");
  });

  it("purgePin removes only that PIN's data", async () => {
    await seed("P1", "X");
    await seed("P2", "X");
    await store.pendingContactRepo.put({ ownPin: "P1", contactPin: "Y", receivedAt: 1 });
    await store.pendingContactRepo.put({ ownPin: "P2", contactPin: "Y", receivedAt: 1 });
    await store.purgePin("P1");
    expect(await store.pendingContactRepo.listAll()).toEqual([{ ownPin: "P2", contactPin: "Y", receivedAt: 1 }]);
    expect(await store.pinRepo.get("P1")).toBeUndefined();
    expect(await store.contactRepo.listForPin("P1")).toHaveLength(0);
    expect(await store.inviteRepo.listForPin("P1")).toHaveLength(0);
    expect(await store.messageRepo.listConversation("P1", "X")).toHaveLength(0);
    expect(await store.pinRepo.get("P2")).toBeDefined();
    expect(await store.contactRepo.listForPin("P2")).toHaveLength(1);
    expect(await store.inviteRepo.listForPin("P2")).toHaveLength(1);
    expect(await store.messageRepo.listConversation("P2", "X")).toHaveLength(1);
  });

  it("transaction rolls back all writes when the callback throws", async () => {
    await expect(
      store.transaction(["pins", "identity"], async (r) => {
        await r.pinRepo.put(pinRec("P9"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.pinRepo.get("P9")).toBeUndefined();
  });

  it("upgrades a version 1 database in place, keeping its data", async () => {
    const name = `pinme-v1-${n++}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("identity");
        db.createObjectStore("pins", { keyPath: "pin" });
        db.createObjectStore("contacts", { keyPath: ["ownPin", "contactPin"] }).createIndex("byOwnPin", "ownPin");
        db.createObjectStore("invites", { keyPath: "inviteId" }).createIndex("byOwnPin", "ownPin");
        const m = db.createObjectStore("messages", { keyPath: ["ownPin", "contactPin", "messageId"] });
        m.createIndex("byConversation", ["ownPin", "contactPin", "ts"]);
        m.createIndex("byOwnPin", "ownPin");
      },
    });
    await v1.put("pins", pinRec("OLD"));
    v1.close();
    const upgraded = await openLocalStore(name);
    expect(await upgraded.pinRepo.get("OLD")).toBeDefined();
    await upgraded.pendingContactRepo.put({ ownPin: "OLD", contactPin: "Z", receivedAt: 2 });
    expect(await upgraded.pendingContactRepo.listAll()).toHaveLength(1);
    upgraded.close();
  });
});
