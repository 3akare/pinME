/** Invite notice helpers: persisted invite quota and held-notice storage. Pure over a storage interface. */
import { INVITE_RATE_LIMIT, INVITE_RATE_WINDOW_MS } from "../shared/limits";
import { ServerMsg } from "../shared/protocol";
import { RateLimiter, type RateLimitResult, type RateLimitState } from "./ratelimit";

export const NOTICE_PREFIX = "notice:";
export const INVITE_QUOTA_KEY = "rl:invite";
/** Single rate-limit bucket key inside the persisted state. */
const BUCKET = "invite";

/** Minimal slice of DurableObjectStorage used here, so fakes can stand in for tests. */
export interface NoticeStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export type InviteNoticeKind = "invite" | "accepted";
export type Notice = Extract<ServerMsg, { type: "inviteNotice" }> & { kind: InviteNoticeKind };

/** Validates an untrusted notice; returns null unless it is an invite or accepted inviteNotice. */
export function parseNotice(raw: unknown): Notice | null {
  const parsed = ServerMsg.safeParse(raw);
  if (!parsed.success || parsed.data.type !== "inviteNotice") return null;
  if (parsed.data.kind !== "invite" && parsed.data.kind !== "accepted") return null;
  return parsed.data as Notice;
}

export type ContactBurnedNotice = Extract<ServerMsg, { type: "contactBurned" }>;
/** Anything that can be held under `notice:*` and flushed after authentication. */
export type HeldNotice = Notice | ContactBurnedNotice;

/** Validates an untrusted notice: invite/accepted inviteNotice or contactBurned. */
export function parseHeldNotice(raw: unknown): HeldNotice | null {
  const parsed = ServerMsg.safeParse(raw);
  if (parsed.success && parsed.data.type === "contactBurned") return parsed.data;
  return parseNotice(raw);
}

/** Consumes one invite slot (10 per 60 minutes), persisting the window in storage. */
export async function checkInviteQuota(storage: NoticeStorage, now: number): Promise<RateLimitResult> {
  const state = (await storage.get<RateLimitState>(INVITE_QUOTA_KEY)) ?? {};
  const limiter = new RateLimiter(state);
  const result = limiter.allow(BUCKET, now, INVITE_RATE_LIMIT, INVITE_RATE_WINDOW_MS);
  limiter.prune(now, INVITE_RATE_WINDOW_MS);
  await storage.put(INVITE_QUOTA_KEY, limiter.snapshot());
  return result;
}

/** Sortable key: zero-padded timestamp keeps held notices in arrival order. */
export function noticeKey(now: number, id: string): string {
  return `${NOTICE_PREFIX}${String(now).padStart(15, "0")}:${id}`;
}

export async function holdNotice(storage: NoticeStorage, notice: HeldNotice, now: number, id: string): Promise<void> {
  await storage.put(noticeKey(now, id), notice);
}

/**
 * Sends every held notice in order via `send`, deleting each after a successful send.
 * Stops at the first failure so remaining notices stay held.
 */
export async function flushNotices(storage: NoticeStorage, send: (notice: HeldNotice) => void): Promise<number> {
  const held = await storage.list<HeldNotice>({ prefix: NOTICE_PREFIX });
  const keys = [...held.keys()].sort();
  let sent = 0;
  for (const key of keys) {
    const notice = parseHeldNotice(held.get(key));
    if (notice) {
      try {
        send(notice);
      } catch {
        break;
      }
      sent++;
    }
    await storage.delete(key);
  }
  return sent;
}
