import type { MessageRecord } from "../storage";

/** Receipts must be sent within this many ms of saving / display. */
export const RECEIPT_DEADLINE_MS = 5000;
const RETRY_MS = 1000;

export interface ReceiptSenderDeps {
  /** Sends a raw frame; false if the session is not authenticated. */
  send: (data: string) => boolean;
  /** True while the chat with `contactPin` (of `ownPin`) is visible to the user. */
  isChatVisible: (ownPin: string, contactPin: string) => boolean;
  now?: () => number;
  /** Injectable timer for retries while disconnected. */
  schedule?: (fn: () => void, ms: number) => void;
}

export interface ReceiptSender {
  /** Pass to ReceiveDeps.onSaved. Sends `delivered`, and `read` if the chat is visible. */
  onSaved(message: MessageRecord): void;
  /** Call when a chat becomes visible/displayed: sends `read` for pending received messages. */
  onChatVisible(ownPin: string, contactPin: string): void;
}

export function createReceiptSender(deps: ReceiptSenderDeps): ReceiptSender {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  /** Received messages whose `read` has not been sent yet (key = own:contact:id). */
  const pendingRead = new Map<string, MessageRecord>();
  const readSent = new Set<string>();
  const keyOf = (m: MessageRecord) => `${m.ownPin}:${m.contactPin}:${m.messageId}`;

  /** Sends once; on failure retries until the 5 s deadline passes. */
  function sendWithRetry(frame: object, since: number, done?: () => void): void {
    const attempt = () => {
      if (deps.send(JSON.stringify(frame))) return done?.();
      if (now() - since + RETRY_MS <= RECEIPT_DEADLINE_MS) schedule(attempt, RETRY_MS);
    };
    attempt();
  }

  function sendRead(m: MessageRecord): void {
    const key = keyOf(m);
    if (readSent.has(key)) return;
    readSent.add(key); // claim now so concurrent triggers send exactly one
    pendingRead.delete(key);
    sendWithRetry({ type: "read", to: m.contactPin, messageId: m.messageId }, now(), () => {});
  }

  return {
    onSaved(m) {
      if (m.direction !== "in") return;
      sendWithRetry({ type: "delivered", to: m.contactPin, messageId: m.messageId }, now());
      if (deps.isChatVisible(m.ownPin, m.contactPin)) sendRead(m);
      else pendingRead.set(keyOf(m), m);
    },
    onChatVisible(ownPin, contactPin) {
      if (!deps.isChatVisible(ownPin, contactPin)) return;
      for (const m of [...pendingRead.values()]) {
        if (m.ownPin === ownPin && m.contactPin === contactPin) sendRead(m);
      }
    },
  };
}
