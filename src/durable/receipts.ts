/**
 * Stored delivery/read receipts for PinMailbox, kept under `rcpt:{ts}:{seq}:{messageId}`.
 * Distinct from ciphertext envelopes (`env:*`). A receipt carries only a Message_ID and the
 * peer PIN. Delivered once on the next authentication, then deleted; purged after 30 days.
 */
import { ENVELOPE_TTL_MS, type OutboxStorage } from "./outbox";

export const RCPT_PREFIX = "rcpt:";
export type ReceiptKind = "delivered" | "read";

export interface StoredReceipt {
  kind: ReceiptKind;
  from: string;
  messageId: string;
  storedAt: number;
}

export function receiptKey(rec: StoredReceipt, seq: string): string {
  return `${RCPT_PREFIX}${String(rec.storedAt).padStart(15, "0")}:${seq}:${rec.kind}:${rec.messageId}`;
}

export function receiptFrame(rec: Pick<StoredReceipt, "kind" | "from" | "messageId">) {
  return { type: rec.kind, from: rec.from, messageId: rec.messageId } as const;
}

export async function storeReceipt(storage: OutboxStorage, rec: StoredReceipt, seq: string): Promise<void> {
  await storage.put(receiptKey(rec, seq), rec);
}

/** Sends stored receipts in order, deleting each after send. Stops at the first send failure. */
export async function flushReceipts(
  storage: OutboxStorage,
  send: (frame: ReturnType<typeof receiptFrame>) => void,
): Promise<number> {
  const held = await storage.list<StoredReceipt>({ prefix: RCPT_PREFIX });
  let sent = 0;
  for (const key of [...held.keys()].sort()) {
    try {
      send(receiptFrame(held.get(key)!));
    } catch {
      break;
    }
    sent++;
    // A failed delete is retried by the next maintenance pass; receipts are idempotent client-side.
    await storage.delete(key).catch(() => false);
  }
  return sent;
}

/** Purges receipts older than 30 days. Returns the next purge time, or null when none are stored. */
export async function purgeReceipts(storage: OutboxStorage, now: number): Promise<number | null> {
  const held = await storage.list<StoredReceipt>({ prefix: RCPT_PREFIX });
  let next: number | null = null;
  for (const [key, rec] of held) {
    const expiry = rec.storedAt + ENVELOPE_TTL_MS + 1;
    if (now >= expiry) {
      const ok = await storage.delete(key).then(() => true, () => false);
      if (ok) continue;
      const retry = now + 5000;
      next = next === null ? retry : Math.min(next, retry);
    } else {
      next = next === null ? expiry : Math.min(next, expiry);
    }
  }
  return next;
}
