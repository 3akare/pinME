import { bytesToBase64 } from "../../shared/base64";
import { MAX_BROADCAST_ENVELOPES, MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import type { MessageRecord } from "../storage";
import type { SendDeps } from "./send";

export type BroadcastDeps = SendDeps;

export interface BroadcastSent {
  contactPin: string;
  messageId: string;
}

export type BroadcastResult =
  | { ok: true; sent: BroadcastSent[]; failed: string[] }
  | { ok: false; code: "disconnected" | "invalid_text" | "unknown_pin" | "no_recipients" };

/**
 * Sends one text to every accepted Contact of `ownPin`. One envelope per Contact,
 * each with its own Message_ID and a fresh nonce (via encrypt). Contacts are sent in
 * chunks of at most 100 envelopes per broadcast frame. Each sent message is recorded
 * locally with the clock marker so receipts advance the per-contact Delivery_Marker.
 */
export async function sendBroadcast(
  deps: BroadcastDeps,
  input: { ownPin: string; text: string },
): Promise<BroadcastResult> {
  const { ownPin, text } = input;
  if (!deps.isConnected()) return { ok: false, code: "disconnected" };
  if (text.length < 1 || text.length > MAX_PLAINTEXT_CHARS) return { ok: false, code: "invalid_text" };
  const pin = await deps.repos.pinRepo.get(ownPin);
  if (!pin) return { ok: false, code: "unknown_pin" };
  const contacts = (await deps.repos.contactRepo.listForPin(ownPin)).filter((c) => !c.unavailable);
  if (contacts.length === 0) return { ok: false, code: "no_recipients" };

  const newId = deps.newMessageId ?? (() => crypto.randomUUID());
  const now = deps.now ?? Date.now;
  const items = contacts.map((c) => {
    const messageId = newId();
    const { nonce, ciphertext } = deps.encrypt(text, c.boxPk, pin.boxSk);
    return {
      contactPin: c.contactPin,
      messageId,
      envelope: {
        to: c.contactPin,
        messageId,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(ciphertext),
      },
    };
  });

  const sent: BroadcastSent[] = [];
  const failed: string[] = [];
  for (let i = 0; i < items.length; i += MAX_BROADCAST_ENVELOPES) {
    const chunk = items.slice(i, i + MAX_BROADCAST_ENVELOPES);
    const frame = { type: "broadcast", envelopes: chunk.map((x) => x.envelope) };
    if (!deps.send(JSON.stringify(frame))) {
      failed.push(...chunk.map((x) => x.contactPin));
      continue;
    }
    for (const x of chunk) {
      const message: MessageRecord = {
        ownPin,
        contactPin: x.contactPin,
        messageId: x.messageId,
        direction: "out",
        text,
        ts: now(),
        marker: "clock",
        kind: "broadcast",
      };
      deps.store.addMessage(message);
      await deps.repos.messageRepo.put(message);
      sent.push({ contactPin: x.contactPin, messageId: x.messageId });
    }
  }
  return { ok: true, sent, failed };
}
