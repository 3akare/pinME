import { bytesToBase64 } from "../../shared/base64";
import { MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import type { MessageRecord, Repositories } from "../storage";

export interface ChatSink {
  addMessage(message: MessageRecord): void;
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
  | { ok: true; message: MessageRecord }
  | { ok: false; code: "disconnected" | "invalid_text" | "unknown_pin" | "unknown_contact" | "send_failed" };

/**
 * Encrypts and sends one chat message, then records it locally with the clock
 * marker. The local record is made synchronously after the send (well within 500 ms).
 * Disabled while disconnected: nothing is encrypted, sent or recorded.
 */
export async function sendMessage(
  deps: SendDeps,
  input: { ownPin: string; contactPin: string; text: string },
): Promise<SendResult> {
  const { ownPin, contactPin, text } = input;
  if (!deps.isConnected()) return { ok: false, code: "disconnected" };
  if (text.length < 1 || text.length > MAX_PLAINTEXT_CHARS) return { ok: false, code: "invalid_text" };
  const [pin, contact] = await Promise.all([
    deps.repos.pinRepo.get(ownPin),
    deps.repos.contactRepo.get(ownPin, contactPin),
  ]);
  if (!pin) return { ok: false, code: "unknown_pin" };
  if (!contact || contact.unavailable) return { ok: false, code: "unknown_contact" };

  const messageId = (deps.newMessageId ?? (() => crypto.randomUUID()))();
  const { nonce, ciphertext } = deps.encrypt(text, contact.boxPk, pin.boxSk);
  const frame = {
    type: "message",
    envelope: {
      to: contactPin,
      messageId,
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
    },
  };
  if (!deps.send(JSON.stringify(frame))) return { ok: false, code: "send_failed" };

  const message: MessageRecord = {
    ownPin,
    contactPin,
    messageId,
    direction: "out",
    text,
    ts: (deps.now ?? Date.now)(),
    marker: "clock",
    kind: "chat",
  };
  deps.store.addMessage(message);
  await deps.repos.messageRepo.put(message);
  return { ok: true, message };
}
