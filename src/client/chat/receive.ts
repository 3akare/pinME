import { base64ToBytes } from "../../shared/base64";
import { EnvelopeSchema } from "../../shared/protocol";
import { decodeGroupPayload, isGroupText, type GroupPayload } from "../groups/payload";
import type { MessageRecord, Repositories } from "../storage";
import type { ChatSink } from "./send";

export interface ReceiveDeps {
  repos: Pick<Repositories, "pinRepo" | "contactRepo" | "messageRepo">;
  store: ChatSink;
  /** Crypto_Module decrypt; returns null on any failure. */
  decrypt: (
    env: { nonce: Uint8Array; ciphertext: Uint8Array },
    senderBoxPk: Uint8Array,
    recipientBoxSk: Uint8Array,
  ) => string | null;
  now?: () => number;
  /** Hook invoked after the message is persisted and in the store (task 9.2 sends receipts from it). */
  onSaved?: (message: MessageRecord) => void;
  /** Group chats: keys of group-mates who are not Contacts, and handling of group payloads. */
  groups?: {
    senderKey(ownPin: string, from: string): Promise<Uint8Array | null>;
    receive(ownPin: string, from: string, messageId: string, payload: GroupPayload): Promise<MessageRecord | null>;
  };
}

/**
 * Handles one incoming `message` frame for `ownPin`. Anything invalid, from a
 * non-contact, or undecryptable is discarded silently: no record, no store update.
 * Returns the saved message, or null if discarded.
 */
export async function receiveMessage(
  deps: ReceiveDeps,
  ownPin: string,
  frame: { from: string; envelope: unknown },
): Promise<MessageRecord | null> {
  const parsed = EnvelopeSchema.safeParse(frame.envelope);
  if (!parsed.success || parsed.data.to !== ownPin) return null;
  const env = parsed.data;
  try {
    const [pin, contact] = await Promise.all([
      deps.repos.pinRepo.get(ownPin),
      deps.repos.contactRepo.get(ownPin, frame.from),
    ]);
    if (!pin) return null;
    // A group-mate who is not a Contact can only send group messages.
    const senderKey = contact?.boxPk ?? (await deps.groups?.senderKey(ownPin, frame.from)) ?? null;
    if (!senderKey) return null;
    const text = deps.decrypt(
      { nonce: base64ToBytes(env.nonce), ciphertext: base64ToBytes(env.ciphertext) },
      senderKey,
      pin.boxSk,
    );
    if (text === null) return null;
    if (isGroupText(text)) {
      const payload = decodeGroupPayload(text);
      const saved = payload && deps.groups ? await deps.groups.receive(ownPin, frame.from, env.messageId, payload) : null;
      if (saved) deps.onSaved?.(saved);
      return saved;
    }
    if (!contact) return null;
    const existing = await deps.repos.messageRepo.get(ownPin, frame.from, env.messageId);
    if (existing) return null; // duplicate delivery
    const message: MessageRecord = {
      ownPin,
      contactPin: frame.from,
      messageId: env.messageId,
      direction: "in",
      text,
      ts: (deps.now ?? Date.now)(),
      kind: "chat",
    };
    await deps.repos.messageRepo.put(message);
    deps.store.addMessage(message);
    deps.onSaved?.(message);
    return message;
  } catch {
    return null;
  }
}
