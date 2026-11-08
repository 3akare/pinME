import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { exportSnapshot, importSnapshot, parseSnapshot } from "./backup";
import { openLocalStore, type PinRecord } from "./index";

let n = 0;
const fresh = () => openLocalStore(`backup-test-${n++}`);

const pin: PinRecord = {
  pin: "AAAAAAAA",
  label: "Main",
  boxSk: new Uint8Array([1, 2, 3]),
  boxPk: new Uint8Array([4]),
  signSk: new Uint8Array([5, 6]),
  signPk: new Uint8Array([7]),
  status: "active",
  personalMessage: "hi",
  createdAt: 1,
  inviteToken: "abcdefghijklmnopqrstuv",
};

describe("device snapshot", () => {
  it("round-trips every store, bytes and pictures included", async () => {
    const a = await fresh();
    await a.identityRepo.put({ displayName: "Ada", picture: new Blob([new Uint8Array([9, 9])], { type: "image/png" }) });
    await a.pinRepo.put(pin);
    await a.contactRepo.put({
      ownPin: "AAAAAAAA",
      contactPin: "BBBBBBBB",
      displayName: "Bo",
      boxPk: new Uint8Array([8]),
      signPk: new Uint8Array([8]),
      status: "active",
      personalMessage: "",
      unavailable: false,
      lastReadAt: 5,
    });
    await a.inviteRepo.put({ inviteId: "i1", ownPin: "AAAAAAAA", fromPin: "CCCCCCCC", createdAt: 2 });
    await a.pendingContactRepo.put({ ownPin: "AAAAAAAA", contactPin: "DDDDDDDD", receivedAt: 3 });
    await a.messageRepo.put({
      ownPin: "AAAAAAAA",
      contactPin: "BBBBBBBB",
      messageId: "m1",
      direction: "out",
      text: "hello",
      ts: 4,
      marker: "R",
      kind: "chat",
    });

    const snap = parseSnapshot(await exportSnapshot(a))!;
    expect(snap).not.toBeNull();
    const b = await fresh();
    expect(await importSnapshot(b, snap)).toBe("restored");

    expect(await b.pinRepo.get("AAAAAAAA")).toEqual(pin);
    expect((await b.contactRepo.get("AAAAAAAA", "BBBBBBBB"))?.lastReadAt).toBe(5);
    expect(await b.inviteRepo.get("i1")).toMatchObject({ fromPin: "CCCCCCCC" });
    expect(await b.pendingContactRepo.listAll()).toHaveLength(1);
    expect((await b.messageRepo.listConversation("AAAAAAAA", "BBBBBBBB"))[0]).toMatchObject({ text: "hello", marker: "R" });
    const id = await b.identityRepo.get();
    expect(id?.displayName).toBe("Ada");
    expect([...new Uint8Array(await id!.picture!.arrayBuffer())]).toEqual([9, 9]);
    expect(id!.picture!.type).toBe("image/png");
  });

  it("never restores over an existing identity", async () => {
    const a = await fresh();
    await a.identityRepo.put({ displayName: "Ada" });
    await a.pinRepo.put(pin);
    const snap = parseSnapshot(await exportSnapshot(a))!;
    const b = await fresh();
    await b.identityRepo.put({ displayName: "Someone else" });
    expect(await importSnapshot(b, snap)).toBe("has_identity");
    expect((await b.identityRepo.get())?.displayName).toBe("Someone else");
    expect(await b.pinRepo.get("AAAAAAAA")).toBeUndefined();
  });

  it("rejects anything that is not a snapshot", () => {
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    expect(parseSnapshot(new TextEncoder().encode("{not json"))).toBeNull();
    expect(parseSnapshot(enc({ version: 2 }))).toBeNull();
    expect(parseSnapshot(enc({ version: 1, identity: { displayName: "x" }, pins: [{ pin: "A" }], contacts: [], invites: [], pendingContacts: [], messages: [] }))).toBeNull();
  });
});
