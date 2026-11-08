import { base64ToBytes, bytesToBase64 } from "../../shared/base64";
import { GROUP_NAME_MAX, MAX_BROADCAST_ENVELOPES, MAX_GROUP_MEMBERS, MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import type { FlowFailure, PublicProfile } from "../invites/flow";
import { groupKey, type GroupMember, type GroupRecord, type MessageRecord, type PinRecord, type Repositories } from "../storage";
import type { EncryptFn } from "../chat/send";
import { encodeGroupPayload, type GroupPayload } from "./payload";

type ServerResult<T> = { ok: true; value: T } | FlowFailure;

interface SignedBody {
  pin: string;
  action: "createGroup" | "leaveGroup";
  ts: number;
  nonce: string;
  payload: unknown;
  signature: string;
}

export interface GroupFlowDeps {
  repos: Pick<Repositories, "pinRepo" | "contactRepo" | "groupRepo" | "messageRepo">;
  chat: {
    addMessage(m: MessageRecord): void;
    updateMessage(m: MessageRecord): void;
    clearConversation(ownPin: string, contactPin: string): void;
  };
  groups: { upsert(g: GroupRecord): void; remove(ownPin: string, groupId: string): void };
  encrypt: EncryptFn;
  /** Sends a raw frame on the own PIN's session; false when not authenticated. */
  send: (ownPin: string, data: string) => boolean;
  isConnected: (ownPin: string) => boolean;
  signRequest: (fields: Omit<SignedBody, "signature">, signSk: Uint8Array) => Uint8Array;
  randomBytes: (n: number) => Uint8Array;
  createGroupFn: (req: SignedBody) => Promise<ServerResult<{ groupId: string; members: string[] }>>;
  leaveGroupFn: (req: SignedBody) => Promise<ServerResult<{ left: boolean }>>;
  getPublicProfileFn: (pin: string) => Promise<ServerResult<PublicProfile>>;
  newId?: () => string;
  now?: () => number;
  /** Waits before leaving server-side (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The farewell travels through the relay, which only passes it while you are still a member, so
 * the server-side leave waits this long behind it.
 */
export const LEAVE_GRACE_MS = 2000;

export type GroupFailure = { ok: false; code: string };

export function createGroupFlow(deps: GroupFlowDeps) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  function sign(own: PinRecord, action: SignedBody["action"], payload: unknown): SignedBody {
    const fields = { pin: own.pin, action, ts: now(), nonce: bytesToBase64(deps.randomBytes(16)), payload };
    return { ...fields, signature: bytesToBase64(deps.signRequest(fields, own.signSk)) };
  }

  /** One envelope per member, sent as broadcast frames of at most 100. False if any frame failed. */
  async function fanOut(own: PinRecord, members: GroupMember[], payload: GroupPayload, messageId: string): Promise<boolean> {
    const text = encodeGroupPayload(payload);
    const envelopes = [];
    for (const m of members) {
      const { nonce, ciphertext } = await deps.encrypt(text, m.boxPk, own.boxSk, { ownPin: own.pin, peerPin: m.pin });
      envelopes.push({ to: m.pin, messageId, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext) });
    }
    for (let i = 0; i < envelopes.length; i += MAX_BROADCAST_ENVELOPES) {
      const frame = { type: "broadcast", envelopes: envelopes.slice(i, i + MAX_BROADCAST_ENVELOPES) };
      if (!deps.send(own.pin, JSON.stringify(frame))) return false;
    }
    return true;
  }

  async function note(ownPin: string, groupId: string, text: string): Promise<MessageRecord> {
    const m: MessageRecord = {
      ownPin,
      contactPin: groupKey(groupId),
      messageId: newId(),
      direction: "in",
      text,
      ts: now(),
      kind: "system",
    };
    await deps.repos.messageRepo.put(m);
    deps.chat.addMessage(m);
    return m;
  }

  async function activePin(ownPin: string): Promise<PinRecord | null> {
    const p = await deps.repos.pinRepo.get(ownPin);
    return p && p.status === "active" ? p : null;
  }

  const api = {
    /** Creates a group of this PIN's contacts, registers it, and tells every member. */
    async create(ownPin: string, name: string, memberPins: string[]): Promise<{ ok: true; group: GroupRecord } | GroupFailure> {
      const clean = name.trim();
      if (clean.length < 1 || clean.length > GROUP_NAME_MAX) return { ok: false, code: "invalid_name" };
      const unique = [...new Set(memberPins)].filter((p) => p !== ownPin);
      if (unique.length < 1 || unique.length > MAX_GROUP_MEMBERS - 1) return { ok: false, code: "invalid_members" };
      if (!deps.isConnected(ownPin)) return { ok: false, code: "disconnected" };
      const own = await activePin(ownPin);
      if (!own) return { ok: false, code: "unknown_pin" };
      const members: GroupMember[] = [];
      for (const pin of unique) {
        const c = await deps.repos.contactRepo.get(ownPin, pin);
        if (!c || c.unavailable) return { ok: false, code: "not_a_contact" };
        members.push({ pin, displayName: c.displayName, boxPk: c.boxPk, signPk: c.signPk });
      }
      const groupId = newId();
      const res = await deps.createGroupFn(sign(own, "createGroup", { groupId, members: unique }));
      if (!res.ok) return { ok: false, code: res.code };
      const group: GroupRecord = { ownPin, groupId, name: clean, members, createdBy: ownPin, createdAt: now() };
      await deps.repos.groupRepo.put(group);
      deps.groups.upsert(group);
      await fanOut(own, members, { t: "create", g: groupId, name: clean, members: [ownPin, ...unique] }, newId());
      await note(ownPin, groupId, `You made ${clean}.`);
      return { ok: true, group };
    },

    /** Records a group message and sends it now, or queues it until the PIN reconnects. */
    async send(ownPin: string, groupId: string, text: string): Promise<{ ok: true; message: MessageRecord } | GroupFailure> {
      if (text.length < 1 || text.length > MAX_PLAINTEXT_CHARS) return { ok: false, code: "invalid_text" };
      const [own, group] = await Promise.all([activePin(ownPin), api.resolve(ownPin, groupId)]);
      if (!own || !group) return { ok: false, code: "unknown_group" };
      const message: MessageRecord = {
        ownPin,
        contactPin: groupKey(groupId),
        messageId: newId(),
        direction: "out",
        text,
        ts: now(),
        kind: "group",
      };
      const sent =
        deps.isConnected(ownPin) && (await fanOut(own, group.members, { t: "msg", g: groupId, text }, message.messageId));
      const saved = sent ? message : { ...message, pending: true };
      deps.chat.addMessage(saved);
      await deps.repos.messageRepo.put(saved);
      return { ok: true, message: saved };
    },

    /** Sends a queued group message (from flushPending); receivers drop repeats by Message_ID. */
    async transmit(m: MessageRecord): Promise<boolean> {
      const groupId = m.contactPin.slice(2);
      const [own, group] = await Promise.all([activePin(m.ownPin), api.resolve(m.ownPin, groupId)]);
      if (!own || !group) return false;
      return fanOut(own, group.members, { t: "msg", g: groupId, text: m.text }, m.messageId);
    },

    /** Tells the others, leaves on the server, and removes the group and its messages here. */
    async leave(ownPin: string, groupId: string): Promise<{ ok: true } | GroupFailure> {
      const [own, group] = await Promise.all([activePin(ownPin), deps.repos.groupRepo.get(ownPin, groupId)]);
      if (!own || !group) return { ok: false, code: "unknown_group" };
      if (deps.isConnected(ownPin) && (await fanOut(own, group.members, { t: "leave", g: groupId }, newId()))) {
        await (deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(LEAVE_GRACE_MS);
      }
      const res = await deps.leaveGroupFn(sign(own, "leaveGroup", { groupId }));
      if (!res.ok && res.code !== "not_found") return { ok: false, code: res.code };
      await deps.repos.groupRepo.delete(ownPin, groupId);
      await deps.repos.messageRepo.deleteConversation(ownPin, groupKey(groupId));
      deps.groups.remove(ownPin, groupId);
      deps.chat.clearConversation(ownPin, groupKey(groupId));
      return { ok: true };
    },

    /**
     * Fetches the keys of members that are still unresolved. Keys come from the Directory, never
     * from the creator; a PIN that is gone (burned, unknown) is dropped from the group.
     */
    async resolve(ownPin: string, groupId: string): Promise<GroupRecord | null> {
      const g = await deps.repos.groupRepo.get(ownPin, groupId);
      if (!g?.unresolved?.length) return g ?? null;
      const members = [...g.members];
      const still: string[] = [];
      for (const pin of g.unresolved) {
        const prof = await deps.getPublicProfileFn(pin).catch(() => null);
        if (prof?.ok)
          members.push({
            pin,
            displayName: prof.value.displayName,
            boxPk: base64ToBytes(prof.value.boxPublicKey),
            signPk: base64ToBytes(prof.value.signPublicKey),
          });
        else if (!prof || (prof.code !== "not_found" && prof.code !== "pin_burned")) still.push(pin); // retry later
      }
      const updated: GroupRecord = { ...g, members };
      if (still.length > 0) updated.unresolved = still;
      else delete updated.unresolved;
      await deps.repos.groupRepo.put(updated);
      deps.groups.upsert(updated);
      return updated;
    },

    /** Finishes key lookups an earlier session did not complete (call once at startup). */
    async resolvePending(ownPins: readonly string[]): Promise<void> {
      for (const own of ownPins) {
        for (const g of await deps.repos.groupRepo.listForPin(own)) {
          if (g.unresolved?.length) await api.resolve(own, g.groupId).catch(() => null);
        }
      }
    },

    /** Public key of a group-mate who is not a Contact, so their group messages can be opened. */
    async senderKey(ownPin: string, from: string): Promise<Uint8Array | null> {
      for (const g of await deps.repos.groupRepo.listForPin(ownPin)) {
        const m = g.members.find((x) => x.pin === from);
        if (m) return m.boxPk;
        if (g.unresolved?.includes(from)) {
          const r = await api.resolve(ownPin, g.groupId);
          const found = r?.members.find((x) => x.pin === from);
          if (found) return found.boxPk;
        }
      }
      return null;
    },

    /** Applies one decrypted group payload; returns the record to show, or null if it was dropped. */
    async receive(ownPin: string, from: string, messageId: string, p: GroupPayload): Promise<MessageRecord | null> {
      const existing = await deps.repos.groupRepo.get(ownPin, p.g);
      if (p.t === "create") {
        // Only a Contact can add you, and the list must name both of you.
        const creator = await deps.repos.contactRepo.get(ownPin, from);
        if (!creator || creator.unavailable || existing) return null;
        if (!p.members.includes(ownPin) || !p.members.includes(from)) return null;
        const members: GroupMember[] = [];
        const unresolved: string[] = [];
        for (const pin of p.members) {
          if (pin === ownPin) continue;
          const c = await deps.repos.contactRepo.get(ownPin, pin);
          if (c && !c.unavailable) members.push({ pin, displayName: c.displayName, boxPk: c.boxPk, signPk: c.signPk });
          else unresolved.push(pin);
        }
        // Saved before any network call; the remaining keys are filled in right after.
        const group: GroupRecord = { ownPin, groupId: p.g, name: p.name, members, createdBy: from, createdAt: now() };
        if (unresolved.length > 0) group.unresolved = unresolved;
        await deps.repos.groupRepo.put(group);
        deps.groups.upsert(group);
        const saved = await note(ownPin, p.g, `${creator.displayName} added you to ${p.name}.`);
        await api.resolve(ownPin, p.g);
        return saved;
      }
      const member = existing?.members.find((m) => m.pin === from);
      if (!existing || !member) return null;
      if (p.t === "leave") {
        const group = { ...existing, members: existing.members.filter((m) => m.pin !== from) };
        await deps.repos.groupRepo.put(group);
        deps.groups.upsert(group);
        return note(ownPin, p.g, `${member.displayName} left.`);
      }
      const key = groupKey(p.g);
      if (await deps.repos.messageRepo.get(ownPin, key, messageId)) return null; // a resend
      const m: MessageRecord = {
        ownPin,
        contactPin: key,
        messageId,
        direction: "in",
        text: p.text,
        ts: now(),
        kind: "group",
        sender: from,
      };
      await deps.repos.messageRepo.put(m);
      deps.chat.addMessage(m);
      return m;
    },
  };
  return api;
}

export type GroupFlow = ReturnType<typeof createGroupFlow>;
