/**
 * Outbox helpers for PinMailbox: stored ciphertext envelopes keyed `env:{ts}:{messageId}`.
 * Pure bookkeeping plus thin storage helpers over a minimal storage interface.
 * Never logs envelope content (Req 17.3).
 */
import type { Envelope } from "../shared/protocol";

export const ENV_PREFIX = "env:";
export const ENVELOPE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DELETE_RETRY_INTERVAL_MS = 5000;
export const MAX_DELETE_RETRIES = 3;

export interface StoredEnvelope {
  from: string;
  envelope: Envelope;
  storedAt: number;
  /** Already sent to a socket. Never re-deliver; only the delete is pending. */
  sentToSocket?: boolean;
  /** Delete retries already performed (after the initial failed attempt). */
  deleteRetries?: number;
  /** When the next delete retry is due; absent once retries are exhausted. */
  nextDeleteAt?: number;
}

export interface OutboxStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

/** Sortable key: zero-padded timestamp keeps envelopes in arrival order. */
export function envelopeKey(ts: number, messageId: string): string {
  return `${ENV_PREFIX}${String(ts).padStart(15, "0")}:${messageId}`;
}

/** True once an envelope has been stored for more than 30 days. */
export function isPurgeable(rec: StoredEnvelope, now: number): boolean {
  return now - rec.storedAt > ENVELOPE_TTL_MS;
}

/** Records that the envelope reached a socket and its first delete failed. */
export function markSentDeletePending(rec: StoredEnvelope, now: number): StoredEnvelope {
  return { ...rec, sentToSocket: true, deleteRetries: 0, nextDeleteAt: now + DELETE_RETRY_INTERVAL_MS };
}

/** Bookkeeping after a failed delete retry: reschedule, or stop after 3 retries. */
export function recordRetryFailure(rec: StoredEnvelope, now: number): StoredEnvelope {
  const retries = (rec.deleteRetries ?? 0) + 1;
  const next: StoredEnvelope = { ...rec, deleteRetries: retries };
  if (retries >= MAX_DELETE_RETRIES) delete next.nextDeleteAt;
  else next.nextDeleteAt = now + DELETE_RETRY_INTERVAL_MS;
  return next;
}

export function isRetryDue(rec: StoredEnvelope, now: number): boolean {
  return rec.sentToSocket === true && rec.nextDeleteAt !== undefined && rec.nextDeleteAt <= now;
}

/** Earliest time the alarm must fire for outbox work, or null when none is pending. */
export function nextOutboxWake(records: Iterable<StoredEnvelope>, now: number): number | null {
  let next: number | null = null;
  const consider = (t: number) => {
    // Overdue work that just failed again is retried on the retry interval, not in a hot loop.
    const at = t <= now ? now + DELETE_RETRY_INTERVAL_MS : t;
    if (next === null || at < next) next = at;
  };
  for (const rec of records) {
    consider(rec.storedAt + ENVELOPE_TTL_MS + 1);
    if (rec.sentToSocket && rec.nextDeleteAt !== undefined) consider(rec.nextDeleteAt);
  }
  return next;
}

export async function storeEnvelope(storage: OutboxStorage, rec: StoredEnvelope): Promise<string> {
  const key = envelopeKey(rec.storedAt, rec.envelope.messageId);
  await storage.put(key, rec);
  return key;
}

async function tryDelete(storage: OutboxStorage, key: string): Promise<boolean> {
  try {
    await storage.delete(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends every stored, not-yet-sent envelope in order via `send`, deleting each right after.
 * A failed delete keeps the record flagged `sentToSocket` so it is retried but never re-sent.
 * Stops at the first send failure so the rest stay stored.
 */
export async function flushOutbox(
  storage: OutboxStorage,
  send: (from: string, envelope: Envelope) => void,
  now: number,
): Promise<{ sent: number; wake: number | null }> {
  const held = await storage.list<StoredEnvelope>({ prefix: ENV_PREFIX });
  let sent = 0;
  let wake: number | null = null;
  for (const key of [...held.keys()].sort()) {
    const rec = held.get(key)!;
    if (rec.sentToSocket) continue;
    try {
      send(rec.from, rec.envelope);
    } catch {
      break;
    }
    sent++;
    if (!(await tryDelete(storage, key))) {
      const pending = markSentDeletePending(rec, now);
      try {
        await storage.put(key, pending);
      } catch {
        // The flag could not be persisted; the next alarm pass still sees the record.
      }
      wake = wake === null ? pending.nextDeleteAt! : Math.min(wake, pending.nextDeleteAt!);
    }
  }
  return { sent, wake };
}

/**
 * Alarm pass: purge envelopes older than 30 days and retry pending deletes.
 * Returns when the next outbox work is due, or null.
 */
export async function runOutboxMaintenance(storage: OutboxStorage, now: number): Promise<number | null> {
  const held = await storage.list<StoredEnvelope>({ prefix: ENV_PREFIX });
  const remaining: StoredEnvelope[] = [];
  for (const key of [...held.keys()].sort()) {
    const rec = held.get(key)!;
    if (isPurgeable(rec, now)) {
      if (await tryDelete(storage, key)) continue;
      remaining.push(rec);
      continue;
    }
    if (isRetryDue(rec, now)) {
      if (await tryDelete(storage, key)) continue;
      const failed = recordRetryFailure(rec, now);
      try {
        await storage.put(key, failed);
      } catch {
        // Keep the old record; it will be retried or purged later.
      }
      remaining.push(failed);
      continue;
    }
    remaining.push(rec);
  }
  return nextOutboxWake(remaining, now);
}
