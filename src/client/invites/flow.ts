import { base64ToBytes, bytesToBase64 } from "../../shared/base64";
import { isValidPin } from "../../shared/pin";
import type { ContactRecord, InviteRecord, PinRecord, Repositories } from "../storage";

/** Failure shape shared with the invite and directory server functions. */
export type FlowFailure = { ok: false; code: string; field?: string; retryAfterSec?: number };
type ServerResult<T> = { ok: true; value: T } | FlowFailure;

/** An incoming invite is shown with only its PIN if the inviter's name takes longer than this. */
export const INVITE_NAME_LOOKUP_MS = 2000;

export interface SignedRequestBody {
  pin: string;
  action: "sendInvite" | "respondInvite";
  ts: number;
  nonce: string;
  payload: unknown;
  signature: string;
}

export interface PublicProfile {
  pin: string;
  boxPublicKey: string;
  signPublicKey: string;
  displayName: string;
  personalMessage: string;
  status?: "available" | "busy";
}

export interface ContactsSink {
  upsertContact(c: ContactRecord): void;
  addInvite(i: InviteRecord): void;
  removeInvite(inviteId: string): void;
}

export interface InviteFlowDeps {
  repos: Pick<Repositories, "contactRepo" | "inviteRepo" | "pinRepo" | "pendingContactRepo">;
  store: ContactsSink;
  /** Crypto_Module signRequest: returns the detached signature over the canonical bytes. */
  signRequest: (
    fields: Omit<SignedRequestBody, "signature">,
    signSk: Uint8Array,
  ) => Uint8Array;
  randomBytes: (n: number) => Uint8Array;
  /** Wrappers over the server functions (call `fn({ data })`). */
  sendInviteFn: (req: SignedRequestBody) => Promise<ServerResult<{ inviteId: string }>>;
  respondInviteFn: (
    req: SignedRequestBody,
  ) => Promise<ServerResult<{ accepted: boolean; contactPin: string }>>;
  getPublicProfileFn: (pin: string) => Promise<ServerResult<PublicProfile>>;
  /** Opens the chat route /chat/$pin. */
  navigate: (to: { pin: string; ownPin: string }) => void;
  /** Told when a counterparty accepted one of our invites (the new Contact is already stored). */
  onAccepted?: (contact: ContactRecord) => void;
  now?: () => number;
}

export type FlowResult = { ok: true } | FlowFailure;

export function createInviteFlow(deps: InviteFlowDeps) {
  const now = deps.now ?? Date.now;

  function sign(own: PinRecord, action: SignedRequestBody["action"], payload: unknown): SignedRequestBody {
    const fields = {
      pin: own.pin,
      action,
      ts: now(),
      nonce: bytesToBase64(deps.randomBytes(16)),
      payload,
    };
    return { ...fields, signature: bytesToBase64(deps.signRequest(fields, own.signSk)) };
  }

  async function ownPinRecord(ownPin: string): Promise<PinRecord | null> {
    const rec = await deps.repos.pinRepo.get(ownPin);
    return rec && rec.status === "active" ? rec : null;
  }

  /** Stores the Contact's public keys and Directory presence locally. */
  async function storeContact(ownPin: string, contactPin: string, p: PublicProfile): Promise<ContactRecord> {
    const record: ContactRecord = {
      ownPin,
      contactPin,
      displayName: p.displayName,
      boxPk: base64ToBytes(p.boxPublicKey),
      signPk: base64ToBytes(p.signPublicKey),
      status: "active",
      personalMessage: p.personalMessage,
      unavailable: false,
      ...(p.status ? { presence: p.status } : {}),
    };
    await deps.repos.contactRepo.put(record);
    deps.store.upsertContact(record);
    return record;
  }

  /** Best-effort display name for an inviter; never throws and never waits long. */
  async function lookupName(pin: string): Promise<string | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        deps.getPublicProfileFn(pin),
        new Promise<null>((r) => {
          timer = setTimeout(() => r(null), INVITE_NAME_LOOKUP_MS);
        }),
      ]);
      return res?.ok ? res.value.displayName : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** Validates the PIN format before any request (Req 4.7). */
    async sendInvite(ownPin: string, to: string): Promise<FlowResult> {
      if (!isValidPin(to)) return { ok: false, code: "validation_failed", field: "pin" };
      const own = await ownPinRecord(ownPin);
      if (!own) return { ok: false, code: "unknown_pin" };
      const res = await deps.sendInviteFn(sign(own, "sendInvite", { to }));
      return res.ok ? { ok: true } : res;
    },

    /**
     * Declines delete the invite locally. Accepts first fetch the inviter's
     * profile (so a failed lookup never leaves a server contact without keys),
     * then respond, store the Contact, drop the invite and open the chat.
     */
    async respondInvite(ownPin: string, inviteId: string, accept: boolean): Promise<FlowResult> {
      const own = await ownPinRecord(ownPin);
      if (!own) return { ok: false, code: "unknown_pin" };
      const invite = await deps.repos.inviteRepo.get(inviteId);
      if (!invite || invite.ownPin !== ownPin) return { ok: false, code: "not_found", field: "inviteId" };

      let profile: PublicProfile | null = null;
      if (accept) {
        const p = await deps.getPublicProfileFn(invite.fromPin);
        if (!p.ok) return p;
        profile = p.value;
      }
      const res = await deps.respondInviteFn(sign(own, "respondInvite", { inviteId, accept }));
      if (!res.ok) return res;

      if (profile) await storeContact(ownPin, invite.fromPin, profile);
      await deps.repos.inviteRepo.delete(inviteId);
      deps.store.removeInvite(inviteId);
      if (accept) deps.navigate({ pin: invite.fromPin, ownPin });
      return { ok: true };
    },

    /** Incoming `invite` notice: persist the pending invite, labelled with the inviter's name when known. */
    async onInvite(ownPin: string, from: string, inviteId: string): Promise<void> {
      const record: InviteRecord = { inviteId, ownPin, fromPin: from, createdAt: now() };
      await deps.repos.inviteRepo.put(record);
      const name = await lookupName(from);
      const named: InviteRecord = name ? { ...record, fromDisplayName: name } : record;
      if (name) await deps.repos.inviteRepo.put(named);
      deps.store.addInvite(named);
    },

    /**
     * Incoming `accepted` notice: store the new Contact's public keys. The acceptance is
     * recorded first so a reload during the profile lookup resumes it instead of losing it.
     */
    async onAccepted(ownPin: string, from: string): Promise<FlowResult> {
      await deps.repos.pendingContactRepo.put({ ownPin, contactPin: from, receivedAt: now() });
      return completeAccepted(ownPin, from);
    },

    /** Finishes acceptances interrupted before their keys were stored (call once at startup). */
    async resumePendingAccepts(): Promise<void> {
      for (const p of await deps.repos.pendingContactRepo.listAll()) {
        if (!(await ownPinRecord(p.ownPin))) {
          await deps.repos.pendingContactRepo.delete(p.ownPin, p.contactPin);
          continue;
        }
        await completeAccepted(p.ownPin, p.contactPin).catch(() => undefined);
      }
    },
  };

  /** Looks up the profile and stores the Contact; a PIN that is gone is dropped, other failures retry later. */
  async function completeAccepted(ownPin: string, from: string): Promise<FlowResult> {
    const res = await deps.getPublicProfileFn(from);
    if (!res.ok) {
      if (res.code === "not_found" || res.code === "pin_burned") {
        await deps.repos.pendingContactRepo.delete(ownPin, from);
      }
      return res;
    }
    const contact = await storeContact(ownPin, from, res.value);
    await deps.repos.pendingContactRepo.delete(ownPin, from);
    deps.onAccepted?.(contact);
    return { ok: true };
  }
}

export type InviteFlow = ReturnType<typeof createInviteFlow>;
