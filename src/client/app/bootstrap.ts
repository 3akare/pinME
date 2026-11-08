import { createInviteFlow, type InviteFlow, type InviteFlowDeps } from "../invites/flow";
import { connectTo, type ConnectOutcome } from "../invites/connect";
import { ensureInviteTokens, resetInviteToken } from "../invites/token";
import { ready, randomBytes, signRequest, decrypt, encrypt } from "../crypto";
import { createReceiptSender, type ReceiptSender } from "../chat/receipts";
import { flushPending } from "../chat/send";
import { registerTypingHandlers, useTypingStore } from "../chat/typing";
import { registerInviteHandlers } from "../net/handlers/invites";
import { createPresenceHandler } from "../net/handlers/presence";
import { registerMessageHandlers } from "../net/handlers/message";
import { registerBurnedHandlers } from "../net/handlers/burned";
import { registerPingHandlers } from "../net/handlers/ping";
import { registerReceiptHandlers } from "../net/handlers/receipts";
import { createConnectionManager, type ConnectionManager } from "../net/manager";
import type { Session } from "../net/session";
import { conversationKey, useChatStore } from "../state/chat";
import { isConnected } from "../state/connection";
import { useContactsStore, hydrateContacts } from "../state/contacts";
import { useIdentityStore } from "../state/identity";
import { usePinsStore } from "../state/pins";
import { useToastStore } from "../state/toasts";
import { openLocalStore, type ContactRecord, type LocalStore, type MessageRecord } from "../storage";
import type { InviteTarget } from "../../shared/scan";
import { getPublicProfileFn } from "../../server/functions/pins";
import { respondInviteFn, sendInviteFn } from "../../server/functions/invites";

let storePromise: Promise<LocalStore> | null = null;
/** Shared Local_Store connection for the app. */
export function getLocalStore(): Promise<LocalStore> {
  storePromise ??= openLocalStore();
  return storePromise;
}

function createFlow(store: LocalStore, extra: Partial<InviteFlowDeps> = {}): InviteFlow {
  const contacts = useContactsStore.getState();
  return createInviteFlow({
    repos: store,
    store: {
      upsertContact: contacts.upsertContact,
      removeInvite: (id) => {
        contacts.removeInvite(id);
        useToastStore.getState().dismissKey(`invite:${id}`);
      },
      addInvite: (i) => {
        contacts.addInvite(i);
        useToastStore.getState().push({
          text: `${i.fromDisplayName ?? i.fromPin} wants to chat.`,
          key: `invite:${i.inviteId}`,
          invite: i,
        });
      },
    },
    signRequest: (fields, sk) => signRequest(fields, sk),
    randomBytes,
    sendInviteFn: (req) => sendInviteFn({ data: req }) as ReturnType<InviteFlowDeps["sendInviteFn"]>,
    respondInviteFn: (req) => respondInviteFn({ data: req }) as ReturnType<InviteFlowDeps["respondInviteFn"]>,
    getPublicProfileFn: (pin) =>
      getPublicProfileFn({ data: { pin } }) as ReturnType<InviteFlowDeps["getPublicProfileFn"]>,
    navigate: () => {},
    onAccepted: (c) => announceContact(c, "accepted your invite."),
    onAutoAccepted: (c) => announceContact(c, "connected using your QR code."),
    ...extra,
  });
}

/** Builds the invite flow wired to the real Crypto_Module, server functions and Local_Store. */
export async function buildInviteFlow(
  navigate: InviteFlowDeps["navigate"] = () => {},
): Promise<InviteFlow> {
  const [store] = await Promise.all([getLocalStore(), ready()]);
  return createFlow(store, { navigate });
}

/** Connects the active PIN to a scanned or linked PIN; see `connectTo`. */
export async function connectToTarget(ownPin: string, target: InviteTarget): Promise<ConnectOutcome> {
  const [store] = await Promise.all([getLocalStore(), ready()]);
  return connectTo(
    { flow: createFlow(store), repos: store, ownPins: usePinsStore.getState().pins.map((p) => p.pin) },
    ownPin,
    target,
  );
}

function wsUrl(pin: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/${pin}`;
}

/** True while this conversation is on screen and the tab is in the foreground. */
function isChatVisible(ownPin: string, contactPin: string): boolean {
  const foreground = typeof document === "undefined" || document.visibilityState === "visible";
  return foreground && useTypingStore.getState().openKey === conversationKey(ownPin, contactPin);
}

function announceContact(c: ContactRecord, what: string): void {
  if (isChatVisible(c.ownPin, c.contactPin)) return;
  useToastStore.getState().push({
    text: `${c.displayName} ${what}`,
    chat: { ownPin: c.ownPin, contactPin: c.contactPin },
    key: `contact:${c.ownPin}:${c.contactPin}`,
  });
}

/** A message arrived for a chat that is not on screen: one toast per conversation. */
function announceMessage(m: MessageRecord): void {
  if (m.direction !== "in" || isChatVisible(m.ownPin, m.contactPin)) return;
  const contact = useContactsStore
    .getState()
    .contacts.find((c) => c.ownPin === m.ownPin && c.contactPin === m.contactPin);
  const preview = m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text;
  useToastStore.getState().push({
    text: `${contact?.displayName ?? m.contactPin}: ${preview}`,
    chat: { ownPin: m.ownPin, contactPin: m.contactPin },
    key: `msg:${m.ownPin}:${m.contactPin}`,
  });
}

/** Relay errors after which a queued message is retried; anything else marks it failed. */
const RETRYABLE = new Set(["rate_limited", "verification_unavailable"]);

const receiptSenders = new Map<string, ReceiptSender>();

/** Registers every frame handler for one own PIN's session; returns their teardown. */
function wireSession(pin: string, session: Session, store: LocalStore): () => void {
  const contacts = useContactsStore.getState();
  const chat = useChatStore.getState();
  const flow = createFlow(store);
  const receipts = createReceiptSender({ send: (d) => session.send(d), isChatVisible });
  receiptSenders.set(pin, receipts);
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () =>
    void flushPending(
      { repos: store, store: chat, encrypt, send: (d) => session.send(d), isConnected: () => isConnected(pin) },
      pin,
    ).catch(() => {});

  /** The relay refused a message (`ref` is its Message_ID): queue it again or mark it failed. */
  const onRefused = async (messageId: string, code: string, retryAfterSec?: number) => {
    const msg = Object.values(useChatStore.getState().messages)
      .flat()
      .find((m) => m.ownPin === pin && m.messageId === messageId && m.direction === "out");
    const saved = msg ?? (await store.db.getAllFromIndex("messages", "byOwnPin", pin)).find((m) => m.messageId === messageId);
    if (!saved || saved.direction !== "out") return;
    const next: MessageRecord = RETRYABLE.has(code)
      ? { ...saved, pending: true, failed: false }
      : { ...saved, pending: false, failed: true };
    await store.messageRepo.put(next);
    chat.updateMessage(next);
    if (RETRYABLE.has(code)) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, Math.max(1, retryAfterSec ?? 2) * 1000);
    }
  };

  const offs = [
    registerInviteHandlers(session.dispatcher, pin, flow, createPresenceHandler(pin, { repos: store, store: contacts })),
    registerTypingHandlers(session.dispatcher, { ownPin: pin }),
    registerPingHandlers(session.dispatcher, { ownPin: pin }),
    registerBurnedHandlers(session.dispatcher, { ownPin: pin, repos: store, store: contacts }),
    registerMessageHandlers(session.dispatcher, {
      ownPin: pin,
      repos: store,
      store: chat,
      decrypt,
      onSaved: (m) => {
        receipts.onSaved(m);
        announceMessage(m);
      },
    }),
    registerReceiptHandlers(session.dispatcher, { ownPin: pin, repos: store, store: chat }),
    session.dispatcher.listen("error", (e) => {
      if (e.ref) void onRefused(e.ref, e.code, e.retryAfterSec).catch(() => {});
    }),
    session.onAuthenticated(flush),
  ];
  return () => {
    clearTimeout(retryTimer);
    if (receiptSenders.get(pin) === receipts) receiptSenders.delete(pin);
    for (const off of offs) off();
  };
}

let manager: ConnectionManager | null = null;
let managerPromise: Promise<ConnectionManager> | null = null;

/** Shared connection manager; every session it starts is fully wired before use. */
export function getConnectionManager(): Promise<ConnectionManager> {
  managerPromise ??= (async () => {
    const [store] = await Promise.all([getLocalStore(), ready()]);
    manager = createConnectionManager({ urlFor: wsUrl, setup: (pin, s) => wireSession(pin, s, store) });
    return manager;
  })();
  return managerPromise;
}

/** Starts or stops sessions so exactly one wired session exists per active PIN. */
export async function startConnections(): Promise<void> {
  const active = usePinsStore.getState().pins.filter((p) => p.status === "active");
  (await getConnectionManager()).sync(active);
}

/** Session for a PIN (undefined until connections start). */
export function getSession(pin: string): Session | undefined {
  return manager?.get(pin);
}

/** Call when a chat is shown or regains focus: sends `read` and clears its unread count. */
export function notifyChatVisible(ownPin: string, contactPin: string): void {
  receiptSenders.get(ownPin)?.onChatVisible(ownPin, contactPin);
  useToastStore.getState().dismissChat(ownPin, contactPin);
  void markConversationRead(ownPin, contactPin).catch(() => {});
}

async function markConversationRead(ownPin: string, contactPin: string): Promise<void> {
  const contact = useContactsStore.getState().contacts.find((c) => c.ownPin === ownPin && c.contactPin === contactPin);
  if (!contact) return;
  const list = useChatStore.getState().messages[conversationKey(ownPin, contactPin)] ?? [];
  const latestIn = list.reduce((t, m) => (m.direction === "in" && m.ts > t ? m.ts : t), 0);
  if (latestIn <= (contact.lastReadAt ?? 0)) return;
  const updated: ContactRecord = { ...contact, lastReadAt: latestIn };
  await (await getLocalStore()).contactRepo.put(updated);
  useContactsStore.getState().upsertContact(updated);
}

/** New QR code and link for a PIN; codes shared before stop connecting automatically. */
export async function resetPinLink(pin: string): Promise<void> {
  const store = await getLocalStore();
  await resetInviteToken({ repos: store, randomBytes, onSaved: (p) => usePinsStore.getState().addPin(p) }, pin);
}

/** Remembers that this device has an identity, so the next load hides the landing page at once. */
function markReturning(on: boolean): void {
  try {
    if (on) localStorage.setItem("pinme:returning", "1");
    else localStorage.removeItem("pinme:returning");
  } catch {
    // storage blocked: the landing page may flash, nothing else changes
  }
  if (!on && typeof document !== "undefined") delete document.documentElement.dataset.returning;
}

let booted: Promise<boolean> | null = null;
/**
 * Loads identity, PINs, contacts and invites from the Local_Store, then
 * starts connections. Resolves true when an identity exists. Only success is
 * cached, so the first call after onboarding still boots the app.
 */
export function bootstrapApp(force = false): Promise<boolean> {
  if (force) booted = null;
  booted ??= (async () => {
    try {
      const store = await getLocalStore();
      const [id, pins] = await Promise.all([store.identityRepo.get(), store.pinRepo.getAll()]);
      useIdentityStore.getState().setLoaded(id ?? null);
      markReturning(!!id);
      if (!id) {
        booted = null;
        return false;
      }
      usePinsStore.getState().setPins(pins);
      await ready();
      await ensureInviteTokens({ repos: store, randomBytes, onSaved: (p) => usePinsStore.getState().addPin(p) }, pins);
      await hydrateContacts(store, pins.map((p) => p.pin));
      await startConnections();
      void createFlow(store).resumePendingAccepts().catch(() => {});
      return true;
    } catch {
      booted = null;
      useIdentityStore.getState().setLoaded(null);
      markReturning(false);
      return false;
    }
  })();
  return booted;
}
