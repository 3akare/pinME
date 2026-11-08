import { describe, expect, it, vi } from "vitest";
import { createDispatcher } from "../net/dispatch";
import { registerInviteHandlers } from "../net/handlers/invites";
import type { ContactRecord, InviteRecord, PendingContactRecord, PinRecord } from "../storage";
import { connectTo } from "./connect";
import { createInviteFlow, INVITE_NAME_LOOKUP_MS, type InviteFlowDeps } from "./flow";

const OWN = "AAAAAAAA";
const OTHER = "BBBBBBBB";
const INVITE_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "abcdefghijklmnopqrstuv";

function setup(overrides: Partial<InviteFlowDeps> = {}) {
  const contacts = new Map<string, ContactRecord>();
  const invites = new Map<string, InviteRecord>();
  const pending = new Map<string, PendingContactRecord>();
  const own = { pin: OWN, signSk: new Uint8Array(64), status: "active", inviteToken: TOKEN } as unknown as PinRecord;
  const sendInviteFn = vi.fn(async (_r: unknown) => ({ ok: true as const, value: { inviteId: INVITE_ID } }));
  const respondInviteFn = vi.fn(async (_r: unknown) => ({
    ok: true as const,
    value: { accepted: true, contactPin: OTHER },
  }));
  const getPublicProfileFn = vi.fn(async (pin: string) => ({
    ok: true as const,
    value: {
      pin,
      boxPublicKey: "AQID",
      signPublicKey: "BAUG",
      displayName: "Bob",
      personalMessage: "hi",
    },
  }));
  const navigate = vi.fn();
  const store = { upsertContact: vi.fn(), addInvite: vi.fn(), removeInvite: vi.fn() };
  const deps: InviteFlowDeps = {
    repos: {
      pinRepo: { get: async (p: string) => (p === OWN ? own : undefined) },
      contactRepo: {
        put: async (c: ContactRecord) => void contacts.set(c.contactPin, c),
        get: async (_o: string, c: string) => contacts.get(c),
      },
      pendingContactRepo: {
        listAll: async () => [...pending.values()],
        put: async (r: PendingContactRecord) => void pending.set(`${r.ownPin}:${r.contactPin}`, r),
        delete: async (o: string, c: string) => void pending.delete(`${o}:${c}`),
      },
      inviteRepo: {
        get: async (id: string) => invites.get(id),
        put: async (i: InviteRecord) => void invites.set(i.inviteId, i),
        delete: async (id: string) => void invites.delete(id),
      },
    } as unknown as InviteFlowDeps["repos"],
    store,
    signRequest: () => new Uint8Array(64),
    randomBytes: (n) => new Uint8Array(n),
    sendInviteFn,
    respondInviteFn,
    getPublicProfileFn,
    navigate,
    now: () => 1000,
    ...overrides,
  };
  return { flow: createInviteFlow(deps), contacts, invites, pending, sendInviteFn, respondInviteFn, getPublicProfileFn, navigate, store };
}

describe("invite flow", () => {
  it("rejects a bad PIN format before any request", async () => {
    const t = setup();
    const r = await t.flow.sendInvite(OWN, "not-a-pin");
    expect(r).toMatchObject({ ok: false, code: "validation_failed" });
    expect(t.sendInviteFn).not.toHaveBeenCalled();
  });

  it("sends a signed sendInvite request with payload {to}", async () => {
    const t = setup();
    expect(await t.flow.sendInvite(OWN, OTHER)).toEqual({ ok: true });
    expect(t.sendInviteFn.mock.calls[0]![0]).toMatchObject({
      pin: OWN,
      action: "sendInvite",
      ts: 1000,
      payload: { to: OTHER },
    });
  });

  it("stores a pending invite from an invite notice via the dispatcher", async () => {
    const t = setup();
    const d = createDispatcher();
    registerInviteHandlers(d, OWN, t.flow);
    d.dispatch(JSON.stringify({ type: "inviteNotice", kind: "invite", from: OTHER, inviteId: INVITE_ID }));
    await vi.waitFor(() =>
      expect(t.store.addInvite).toHaveBeenCalledWith(
        expect.objectContaining({ inviteId: INVITE_ID, fromPin: OTHER, fromDisplayName: "Bob" }),
      ),
    );
    expect(t.invites.get(INVITE_ID)?.fromDisplayName).toBe("Bob");
  });

  it("still surfaces an invite when the inviter's name cannot be looked up", async () => {
    const t = setup({ getPublicProfileFn: async () => ({ ok: false, code: "verification_unavailable" }) });
    await t.flow.onInvite(OWN, OTHER, INVITE_ID);
    expect(t.store.addInvite).toHaveBeenCalledTimes(1);
    expect(t.invites.get(INVITE_ID)).toEqual({ inviteId: INVITE_ID, ownPin: OWN, fromPin: OTHER, createdAt: 1000 });
  });

  it("does not wait on a slow name lookup", async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ getPublicProfileFn: () => new Promise(() => {}) });
      const done = t.flow.onInvite(OWN, OTHER, INVITE_ID);
      await vi.advanceTimersByTimeAsync(INVITE_NAME_LOOKUP_MS);
      await done;
      expect(t.store.addInvite).toHaveBeenCalledWith(expect.objectContaining({ fromPin: OTHER }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("accept stores contact keys, removes invite and opens the chat", async () => {
    const t = setup();
    await t.flow.onInvite(OWN, OTHER, INVITE_ID);
    expect(await t.flow.respondInvite(OWN, INVITE_ID, true)).toEqual({ ok: true });
    expect(t.respondInviteFn.mock.calls[0]![0]).toMatchObject({
      action: "respondInvite",
      payload: { inviteId: INVITE_ID, accept: true },
    });
    expect([...t.contacts.get(OTHER)!.boxPk]).toEqual([1, 2, 3]);
    expect(t.invites.has(INVITE_ID)).toBe(false);
    expect(t.navigate).toHaveBeenCalledWith({ pin: OTHER, ownPin: OWN });
  });

  it("accept does not respond when the profile lookup fails", async () => {
    const t = setup({ getPublicProfileFn: async () => ({ ok: false, code: "not_found" }) });
    await t.flow.onInvite(OWN, OTHER, INVITE_ID);
    expect(await t.flow.respondInvite(OWN, INVITE_ID, true)).toMatchObject({ ok: false });
    expect(t.respondInviteFn).not.toHaveBeenCalled();
    expect(t.invites.has(INVITE_ID)).toBe(true);
  });

  it("decline removes the invite without storing a contact or navigating", async () => {
    const t = setup();
    await t.flow.onInvite(OWN, OTHER, INVITE_ID);
    expect(await t.flow.respondInvite(OWN, INVITE_ID, false)).toEqual({ ok: true });
    expect(t.contacts.size).toBe(0);
    expect(t.navigate).not.toHaveBeenCalled();
  });

  it("accepted notice stores the new contact's keys", async () => {
    const t = setup();
    const d = createDispatcher();
    registerInviteHandlers(d, OWN, t.flow);
    d.dispatch(JSON.stringify({ type: "inviteNotice", kind: "accepted", from: OTHER }));
    await vi.waitFor(() => expect(t.contacts.has(OTHER)).toBe(true));
  });

  it("accepted notice records Directory presence and reports the new contact", async () => {
    const onAccepted = vi.fn();
    const t = setup({
      onAccepted,
      getPublicProfileFn: async (pin: string) => ({
        ok: true as const,
        value: { pin, boxPublicKey: "AQID", signPublicKey: "BAUG", displayName: "Bob", personalMessage: "", status: "busy" as const },
      }),
    });
    expect(await t.flow.onAccepted(OWN, OTHER)).toEqual({ ok: true });
    expect(t.contacts.get(OTHER)?.presence).toBe("busy");
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ ownPin: OWN, contactPin: OTHER, displayName: "Bob" }));
  });

  it("an acceptance interrupted before its keys were stored is resumed at startup", async () => {
    let online = false;
    const t = setup({
      getPublicProfileFn: async (pin: string) =>
        online
          ? { ok: true as const, value: { pin, boxPublicKey: "AQID", signPublicKey: "BAUG", displayName: "Bob", personalMessage: "" } }
          : { ok: false as const, code: "verification_unavailable" },
    });
    expect(await t.flow.onAccepted(OWN, OTHER)).toMatchObject({ ok: false });
    expect(t.contacts.has(OTHER)).toBe(false);
    expect(t.pending.size).toBe(1);
    online = true;
    await t.flow.resumePendingAccepts();
    expect(t.contacts.has(OTHER)).toBe(true);
    expect(t.pending.size).toBe(0);
  });

  it("drops a pending acceptance whose PIN no longer exists", async () => {
    const t = setup({ getPublicProfileFn: async () => ({ ok: false as const, code: "pin_burned" }) });
    await t.flow.onAccepted(OWN, OTHER);
    expect(t.pending.size).toBe(0);
    expect(t.contacts.has(OTHER)).toBe(false);
  });

  it("accept fetches the inviter's profile once", async () => {
    const t = setup();
    await t.flow.onInvite(OWN, OTHER, INVITE_ID);
    t.getPublicProfileFn.mockClear();
    await t.flow.respondInvite(OWN, INVITE_ID, true);
    expect(t.getPublicProfileFn).toHaveBeenCalledTimes(1);
  });

  it("an invite carrying this PIN's link token is accepted without asking", async () => {
    const onAutoAccepted = vi.fn();
    const t = setup({ onAutoAccepted });
    await t.flow.onInvite(OWN, OTHER, INVITE_ID, TOKEN);
    expect(t.respondInviteFn.mock.calls[0]![0]).toMatchObject({ payload: { inviteId: INVITE_ID, accept: true } });
    expect(t.contacts.has(OTHER)).toBe(true);
    expect(t.store.addInvite).not.toHaveBeenCalled();
    expect(onAutoAccepted).toHaveBeenCalledWith(expect.objectContaining({ contactPin: OTHER }));
  });

  it("a wrong or missing token leaves the invite for the user to answer", async () => {
    const t = setup();
    await t.flow.onInvite(OWN, OTHER, INVITE_ID, "zzzzzzzzzzzzzzzzzzzzzz");
    expect(t.respondInviteFn).not.toHaveBeenCalled();
    expect(t.store.addInvite).toHaveBeenCalledWith(expect.objectContaining({ inviteId: INVITE_ID }));
  });

  it("sends the scanned link token with the invite", async () => {
    const t = setup();
    await t.flow.sendInvite(OWN, OTHER, TOKEN);
    expect(t.sendInviteFn.mock.calls[0]![0]).toMatchObject({ payload: { to: OTHER, token: TOKEN } });
  });
});

describe("connectTo", () => {
  const flow = (over: Partial<Parameters<typeof connectTo>[0]["flow"]> = {}) => ({
    sendInvite: vi.fn(async () => ({ ok: true as const })),
    respondInvite: vi.fn(async () => ({ ok: true as const })),
    ...over,
  });
  const repos = (contact?: Partial<ContactRecord>, invites: InviteRecord[] = []) =>
    ({
      contactRepo: { get: async () => contact as ContactRecord | undefined },
      inviteRepo: { listForPin: async () => invites },
    }) as never;

  it("opens the chat with an existing contact", async () => {
    expect(await connectTo({ flow: flow(), repos: repos({ unavailable: false }), ownPins: [OWN] }, OWN, { pin: OTHER })).toEqual({ kind: "chat" });
  });
  it("accepts their pending invite instead of sending another", async () => {
    const f = flow();
    const inv = { inviteId: INVITE_ID, ownPin: OWN, fromPin: OTHER, createdAt: 1 };
    expect(await connectTo({ flow: f, repos: repos(undefined, [inv]), ownPins: [OWN] }, OWN, { pin: OTHER })).toEqual({ kind: "accepted" });
    expect(f.respondInvite).toHaveBeenCalledWith(OWN, INVITE_ID, true);
    expect(f.sendInvite).not.toHaveBeenCalled();
  });
  it("sends an invite with the token and waits; a duplicate also waits", async () => {
    const f = flow();
    expect(await connectTo({ flow: f, repos: repos(), ownPins: [OWN] }, OWN, { pin: OTHER, token: TOKEN })).toEqual({ kind: "waiting" });
    expect(f.sendInvite).toHaveBeenCalledWith(OWN, OTHER, TOKEN);
    const dup = flow({ sendInvite: vi.fn(async () => ({ ok: false as const, code: "duplicate" })) });
    expect(await connectTo({ flow: dup, repos: repos(), ownPins: [OWN] }, OWN, { pin: OTHER })).toEqual({ kind: "waiting" });
  });
  it("refuses your own PIN", async () => {
    expect(await connectTo({ flow: flow(), repos: repos(), ownPins: [OWN, OTHER] }, OWN, { pin: OTHER })).toEqual({ kind: "own" });
  });
});
