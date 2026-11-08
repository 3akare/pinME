/** Presence retention helpers (Req 11.6, 11.7). Latest presence per sender under a replaceable key. */
import { ServerMsg } from "../shared/protocol";
import type { NoticeStorage } from "./notices";

export const PRESENCE_PREFIX = "presence:";

export type PresenceNotice = Extract<ServerMsg, { type: "inviteNotice" }> & {
  kind: "presence";
  status: "available" | "busy";
  personalMessage: string;
};

/** Validates an untrusted presence notice; null unless inviteNotice/presence with from, status and personalMessage. */
export function parsePresence(raw: unknown): PresenceNotice | null {
  const parsed = ServerMsg.safeParse(raw);
  if (!parsed.success || parsed.data.type !== "inviteNotice" || parsed.data.kind !== "presence") return null;
  if (parsed.data.status === undefined || parsed.data.personalMessage === undefined) return null;
  return parsed.data as PresenceNotice;
}

export function presenceKey(from: string): string {
  return `${PRESENCE_PREFIX}${from}`;
}

/** Retains the notice, replacing any earlier presence from the same sender. */
export async function retainPresence(storage: NoticeStorage, notice: PresenceNotice): Promise<void> {
  await storage.put(presenceKey(notice.from), notice);
}

/**
 * Sends every retained presence via `send`, deleting each after a successful send.
 * Stops at the first send failure so the remainder stays retained.
 */
export async function flushPresence(storage: NoticeStorage, send: (notice: PresenceNotice) => void): Promise<number> {
  const held = await storage.list<PresenceNotice>({ prefix: PRESENCE_PREFIX });
  let sent = 0;
  for (const key of [...held.keys()].sort()) {
    const notice = parsePresence(held.get(key));
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
