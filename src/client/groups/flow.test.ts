import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../../shared/base64";
import { decrypt, encrypt, generatePinKeys, ready } from "../crypto";
import { openLocalStore, groupKey, type ContactRecord, type LocalStore, type PinRecord } from "../storage";
import { createGroupFlow, type GroupFlowDeps } from "./flow";
import { decodeGroupPayload, encodeGroupPayload } from "./payload";

const A = "AAAAAAAA"; // me
const B = "BBBBBBBB"; // my contact, the creator
const C = "CCCCCCCC"; // a group-mate I do not know
const G = "11111111-1111-4111-8111-111111111111";
let n = 0;
let keys: Record<string, ReturnType<typeof generatePinKeys>>;

beforeAll(async () => {
  await ready();
  keys = { A: generatePinKeys(), B: generatePinKeys(), C: generatePinKeys() };
});

async function setup(over: Partial<GroupFlowDeps> = {}) {
  const store: LocalStore = await openLocalStore(`groups-${n++}`);
  const pin: PinRecord = {
    pin: A,
    label: "Main",
    boxSk: keys.A!.box.privateKey,
    boxPk: keys.A!.box.publicKey,
    signSk: keys.A!.sign.privateKey,
    signPk: keys.A!.sign.publicKey,
    status: "active",
    personalMessage: "",
    createdAt: 1,
  };
  await store.pinRepo.put(pin);
  const contact: ContactRecord = {
    ownPin: A,
    contactPin: B,
    displayName: "Bo",
    boxPk: keys.B!.box.publicKey,
    signPk: keys.B!.sign.publicKey,
    status: "active",
    personalMessage: "",
    unavailable: false,
  };
  await store.contactRepo.put(contact);
  const frames: string[] = [];
  const chat = { addMessage: vi.fn(), updateMessage: vi.fn(), clearConversation: vi.fn() };
  const getPublicProfileFn = vi.fn(async (pin: string) => ({
    ok: true as const,
    value: { pin, boxPublicKey: bytesToBase64(keys.C!.box.publicKey), signPublicKey: "", displayName: "Cy", personalMessage: "" },
  }));
  const deps: GroupFlowDeps = {
    repos: store,
    chat,
    groups: { upsert: vi.fn(), remove: vi.fn() },
    encrypt,
    send: (_own, d) => (frames.push(d), true),
    isConnected: () => true,
    signRequest: () => new Uint8Array(64),
    randomBytes: (k) => new Uint8Array(k),
    createGroupFn: vi.fn(async () => ({ ok: true as const, value: { groupId: G, members: [A, B] } })),
    leaveGroupFn: vi.fn(async () => ({ ok: true as const, value: { left: true } })),
    getPublicProfileFn,
    ...over,
  };
  return { store, flow: createGroupFlow(deps), frames, chat, deps, getPublicProfileFn };
}

describe("group payloads", () => {
  it("round-trips and rejects anything malformed", () => {
    const create = { t: "create" as const, g: G, name: "Trip", members: [A, B] };
    expect(decodeGroupPayload(encodeGroupPayload(create))).toEqual(create);
    expect(decodeGroupPayload("hello")).toBeNull();
    expect(decodeGroupPayload(encodeGroupPayload({ t: "msg", g: "not-a-uuid", text: "x" }))).toBeNull();
    expect(decodeGroupPayload(encodeGroupPayload({ ...create, members: [A] }))).toBeNull();
    expect(decodeGroupPayload(encodeGroupPayload({ ...create, members: [A, A] }))).toBeNull();
    expect(decodeGroupPayload(encodeGroupPayload({ t: "msg", g: G, text: "" }))).toBeNull();
  });
});

describe("group flow", () => {
  it("joins a group made by a contact, taking unknown members' keys from the Directory", async () => {
    const t = await setup();
    const note = await t.flow.receive(A, B, "m0", { t: "create", g: G, name: "Trip", members: [B, A, C] });
    expect(note?.text).toBe("Bo added you to Trip.");
    const g = await t.store.groupRepo.get(A, G);
    expect(g?.members.map((m) => m.pin).sort()).toEqual([B, C]);
    expect(t.getPublicProfileFn).toHaveBeenCalledWith(C);
    expect([...g!.members.find((m) => m.pin === C)!.boxPk]).toEqual([...keys.C!.box.publicKey]);
    expect([...(await t.flow.senderKey(A, C))!]).toEqual([...keys.C!.box.publicKey]);
  });

  it("ignores a group created by someone who is not a contact", async () => {
    const t = await setup();
    expect(await t.flow.receive(A, C, "m0", { t: "create", g: G, name: "Spam", members: [C, A] })).toBeNull();
    expect(await t.store.groupRepo.get(A, G)).toBeUndefined();
  });

  it("files members' messages once, and drops messages from non-members", async () => {
    const t = await setup();
    await t.flow.receive(A, B, "m0", { t: "create", g: G, name: "Trip", members: [B, A, C] });
    const msg = await t.flow.receive(A, C, "m1", { t: "msg", g: G, text: "hi all" });
    expect(msg).toMatchObject({ contactPin: groupKey(G), sender: C, kind: "group", text: "hi all" });
    expect(await t.flow.receive(A, C, "m1", { t: "msg", g: G, text: "hi all" })).toBeNull();
    expect(await t.flow.receive(A, "DDDDDDDD", "m2", { t: "msg", g: G, text: "intruder" })).toBeNull();
  });

  it("sends one envelope per member that each member can open, and queues offline", async () => {
    let online = true;
    const t = await setup({ isConnected: () => online });
    await t.flow.receive(A, B, "m0", { t: "create", g: G, name: "Trip", members: [B, A, C] });
    const res = await t.flow.send(A, G, "on my way");
    expect(res.ok && res.message.pending).toBeFalsy();
    const frame = JSON.parse(t.frames[0]!);
    expect(frame.type).toBe("broadcast");
    expect(frame.envelopes.map((e: { to: string }) => e.to).sort()).toEqual([B, C]);
    const forC = frame.envelopes.find((e: { to: string }) => e.to === C);
    const opened = decrypt(
      { nonce: Buffer.from(forC.nonce, "base64"), ciphertext: Buffer.from(forC.ciphertext, "base64") },
      keys.A!.box.publicKey,
      keys.C!.box.privateKey,
    );
    expect(decodeGroupPayload(opened!)).toEqual({ t: "msg", g: G, text: "on my way" });

    online = false;
    const queued = await t.flow.send(A, G, "later");
    expect(queued.ok && queued.message.pending).toBe(true);
  });

  it("leaving tells the others, leaves on the server and removes the group here", async () => {
    const t = await setup();
    await t.flow.receive(A, B, "m0", { t: "create", g: G, name: "Trip", members: [B, A] });
    expect(await t.flow.leave(A, G)).toEqual({ ok: true });
    expect(t.frames).toHaveLength(1);
    expect(t.deps.leaveGroupFn).toHaveBeenCalled();
    expect(await t.store.groupRepo.get(A, G)).toBeUndefined();
    expect(await t.store.messageRepo.listConversation(A, groupKey(G))).toEqual([]);
  });

  it("makes a group only from contacts, and only online", async () => {
    const t = await setup();
    expect(await t.flow.create(A, "Trip", [C])).toEqual({ ok: false, code: "not_a_contact" });
    const offline = await setup({ isConnected: () => false });
    expect(await offline.flow.create(A, "Trip", [B])).toEqual({ ok: false, code: "disconnected" });
    const ok = await t.flow.create(A, "Trip", [B]);
    expect(ok.ok).toBe(true);
    expect(JSON.parse(t.frames[0]!).envelopes).toHaveLength(1);
  });
});
