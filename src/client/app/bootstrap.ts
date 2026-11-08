import { createInviteFlow, type InviteFlow, type InviteFlowDeps } from "../invites/flow";
import { ready, randomBytes, signRequest, decrypt } from "../crypto";
import { createReceiptSender, type ReceiptSender } from "../chat/receipts";
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
import { useContactsStore, hydrateContacts } from "../state/contacts";
import { useIdentityStore } from "../state/identity";
import { usePinsStore } from "../state/pins";
import { useToastStore } from "../state/toasts";
import { openLocalStore, type ContactRecord, type LocalStore } from "../storage";
import { getPublicProfileFn } from "../../server/functions/pins";
import { respondInviteFn, sendInviteFn } from "../../server/functions/invites";

let storePromise: Promise<LocalStore> | null = null;
/** Shared Local_Store connection for the app. */
export function getLocalStore(): Promise<LocalStore> {
  storePromise ??= openLocalStore();
  return storePromise;
}

function createFlow(store: LocalStore, extra: Partial<InviteFlowDeps> = {}): InviteFlow {
  return createInviteFlow({
    repos: store,
    store: useContactsStore.getState(),
    signRequest: (fields, sk) => signRequest(fields, sk),
    randomBytes,
    sendInviteFn: (req) => sendInviteFn({ data: req }) as ReturnType<InviteFlowDeps["sendInviteFn"]>,
    respondInviteFn: (req) => respondInviteFn({ data: req }) as ReturnType<InviteFlowDeps["respondInviteFn"]>,
    getPublicProfileFn: (pin) =>
      getPublicProfileFn({ data: { pin } }) as ReturnType<InviteFlowDeps["getPublicProfileFn"]>,
    navigate: () => {},
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

function wsUrl(pin: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/${pin}`;
}

/** True while this conversation is on screen and the tab is in the foreground. */
function isChatVisible(ownPin: string, contactPin: string): boolean {
  const foreground = typeof document === "undefined" || document.visibilityState === "visible";
  return foreground && useTypingStore.getState().openKey === conversationKey(ownPin, contactPin);
}

const receiptSenders = new Map<string, ReceiptSender>();

function announceAccepted(c: ContactRecord): void {
  useToastStore.getState().push({
    text: `${c.displayName} accepted your invite.`,
    chat: { ownPin: c.ownPin, contactPin: c.contactPin },
  });
}

/** Registers every frame handler for one own PIN's session; returns their teardown. */
function wireSession(pin: string, session: Session, store: LocalStore): () => void {
  const contacts = useContactsStore.getState();
  const chat = useChatStore.getState();
  const flow = createFlow(store, { onAccepted: announceAccepted });
  const receipts = createReceiptSender({ send: (d) => session.send(d), isChatVisible });
  receiptSenders.set(pin, receipts);
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
      onSaved: receipts.onSaved,
    }),
    registerReceiptHandlers(session.dispatcher, { ownPin: pin, repos: store, store: chat }),
  ];
  return () => {
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

/** Call when a chat is shown or regains focus: sends `read` for messages that arrived while hidden. */
export function notifyChatVisible(ownPin: string, contactPin: string): void {
  receiptSenders.get(ownPin)?.onChatVisible(ownPin, contactPin);
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
      if (!id) {
        booted = null;
        return false;
      }
      usePinsStore.getState().setPins(pins);
      await hydrateContacts(store, pins.map((p) => p.pin));
      await startConnections();
      void createFlow(store, { onAccepted: announceAccepted }).resumePendingAccepts().catch(() => {});
      return true;
    } catch {
      booted = null;
      useIdentityStore.getState().setLoaded(null);
      return false;
    }
  })();
  return booted;
}
