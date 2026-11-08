import { bytesToBase64 } from "../../shared/base64";
import { MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import type { MessageRecord, Repositories } from "../storage";

export interface ChatSink {
  addMessage(message: MessageRecord): void;
}

/** Sink that can also replace a message already in the store (queued -> sent). */
export interface QueueSink extends ChatSink {
  updateMessage(message: MessageRecord): void;
}

export interface SendDeps {
  repos: Pick<Repositories, "pinRepo" | "contactRepo" | "messageRepo">;
  store: ChatSink;
  /** Crypto_Module encrypt. */
  encrypt: (
    plain: string,
    recipientBoxPk: Uint8Array,
    senderBoxSk: Uint8Array,
  ) => { nonce: Uint8Array; ciphertext: Uint8Array };
  /** Sends a raw frame; false if the session is not authenticated. */
  send: (data: string) => boolean;
  isConnected: () => boolean;
  newMessageId?: () => string;
  now?: () => number;
}

export type SendResult =
  | { ok: true; message: MessageRecord; queued: boolean }
  | { ok: false; code: "invalid_text" | "unknown_pin" | "unknown_contact" };

/** Encrypts a fresh envelope for the message and hands it to the socket. */
function transmit(
  deps: Pick<SendDeps, "encrypt" | "send">,
  m: MessageRecord,
  recipientBoxPk: Uint8Array,
  senderBoxSk: Uint8Array,
): boolean {
  const { nonce, ciphertext } = deps.encrypt(m.text, recipientBoxPk, senderBoxSk);
  const frame = {
    type: "message",
    envelope: { to: m.contactPin, messageId: m.messageId, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext) },
  };
  return deps.send(JSON.stringify(frame));
}

/**
 * Records one chat message locally (clock marker) and sends it. While offline the message is
 * kept as `pending` and goes out when the session authenticates (see `flushPending`), so the
 * user never loses what they typed to a dropped connection.
 */
export async function sendMessage(
  deps: SendDeps,
  input: { ownPin: string; contactPin: string; text: string },
): Promise<SendResult> {
  const { ownPin, contactPin, text } = input;
  if (text.length < 1 || text.length > MAX_PLAINTEXT_CHARS) return { ok: false, code: "invalid_text" };
  const [pin, contact] = await Promise.all([
    deps.repos.pinRepo.get(ownPin),
    deps.repos.contactRepo.get(ownPin, contactPin),
  ]);
  if (!pin) return { ok: false, code: "unknown_pin" };
  if (!contact || contact.unavailable) return { ok: false, code: "unknown_contact" };

  const message: MessageRecord = {
    ownPin,
    contactPin,
    messageId: (deps.newMessageId ?? (() => crypto.randomUUID()))(),
    direction: "out",
    text,
    ts: (deps.now ?? Date.now)(),
    marker: "clock",
    kind: "chat",
  };
  const sent = deps.isConnected() && transmit(deps, message, contact.boxPk, pin.boxSk);
  const saved: MessageRecord = sent ? message : { ...message, pending: true };
  deps.store.addMessage(saved);
  await deps.repos.messageRepo.put(saved);
  return { ok: true, message: saved, queued: !sent };
}

/** Most queued messages sent per flush; stays under the 30-per-10-s relay limit. */
export const FLUSH_BATCH = 20;

/**
 * Sends queued messages of one own PIN, oldest first, stopping at the first send that fails.
 * Messages to contacts that are gone are marked failed. Returns how many were sent.
 */
export async function flushPending(
  deps: Omit<SendDeps, "store" | "newMessageId" | "now"> & { store: QueueSink },
  ownPin: string,
): Promise<number> {
  const pin = await deps.repos.pinRepo.get(ownPin);
  if (!pin) return 0;
  let sent = 0;
  for (const m of (await deps.repos.messageRepo.listPending(ownPin)).slice(0, FLUSH_BATCH)) {
    if (!deps.isConnected()) break;
    const contact = await deps.repos.contactRepo.get(ownPin, m.contactPin);
    if (!contact || contact.unavailable) {
      const failed: MessageRecord = { ...m, pending: false, failed: true };
      await deps.repos.messageRepo.put(failed);
      deps.store.updateMessage(failed);
      continue;
    }
    if (!transmit(deps, m, contact.boxPk, pin.boxSk)) break;
    const done: MessageRecord = { ...m, pending: false };
    await deps.repos.messageRepo.put(done);
    deps.store.updateMessage(done);
    sent++;
  }
  return sent;
}
