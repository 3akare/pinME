/**
 * Invite service (Req 4.1, 4.4, 4.5, 4.8-4.11, 13.11).
 *
 * Pure over injectable collaborators: an `InviteRepository` (Directory), a
 * `MailboxFor` factory (PinMailbox RPC stubs) and `verifySignedRequest` deps.
 */
import { and, eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { burnedPins, contacts, invites, pins } from "../db/schema";
import { PIN_REGEX } from "../shared/pin";
import type { ErrorCode } from "../shared/protocol";
import { safeLog } from "../shared/safeLog";
import { guardPrivateKeys } from "./guard";
import { verifySignedRequest, type VerifyDeps } from "./signedRequest";

export interface InviteRepository {
  pinExists(pin: string): Promise<boolean>;
  isBurned(pin: string): Promise<boolean>;
  /** True when a pending invite or a contact pair exists between a and b in either direction. */
  linked(a: string, b: string): Promise<boolean>;
  /** Inserts a pending invite; null when a concurrent duplicate won. */
  insertInvite(from: string, to: string): Promise<{ id: string } | null>;
  getInvite(id: string): Promise<{ id: string; fromPin: string; toPin: string } | null>;
  /** Atomic: deletes the invite and inserts the ordered contact pair. False if the invite was gone. */
  acceptInvite(id: string): Promise<boolean>;
  /** Returns true if a row was deleted. */
  deleteInvite(id: string): Promise<boolean>;
}

export interface QuotaResult {
  ok: boolean;
  retryAfterMs: number;
}

export interface InviteNoticeInput {
  type: "inviteNotice";
  kind: "invite" | "accepted";
  from: string;
  inviteId?: string;
}

/** The PinMailbox RPC surface used here. */
export interface InviteMailbox {
  checkInviteQuota(): Promise<QuotaResult>;
  pushNotice(notice: InviteNoticeInput): Promise<unknown>;
  invalidatePairs(): Promise<void> | void;
}

export type MailboxFor = (pin: string) => InviteMailbox;

export interface InviteDeps {
  repo: InviteRepository;
  mailboxFor: MailboxFor;
  verify: VerifyDeps;
}

export type InviteFailure = { ok: false; code: ErrorCode; field?: string; retryAfterSec?: number };
export type InviteResult<T> = { ok: true; value: T } | InviteFailure;

export interface InviteFacts {
  senderPin: string;
  target: unknown;
  targetExists: boolean;
  targetBurned: boolean;
  linked: boolean;
}

/**
 * Pure decision for sendInvite, excluding the quota (which has side effects).
 * Order: format, not found, burned, self, duplicate. Returns null when allowed.
 */
export function decideInvite(f: InviteFacts): ErrorCode | null {
  if (typeof f.target !== "string" || !PIN_REGEX.test(f.target)) return "validation_failed";
  if (f.targetBurned) return "pin_burned";
  if (!f.targetExists) return "not_found";
  if (f.target === f.senderPin) return "self_invite";
  if (f.linked) return "duplicate";
  return null;
}

/** Ordered contact pair so a pair has exactly one row (low < high). */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function fail(code: ErrorCode, field?: string, retryAfterSec?: number): InviteFailure {
  safeLog("invite_rejected", { code, field });
  const out: InviteFailure = { ok: false, code };
  if (field !== undefined) out.field = field;
  if (retryAfterSec !== undefined) out.retryAfterSec = retryAfterSec;
  return out;
}

async function verified(req: unknown, action: "sendInvite" | "respondInvite", deps: InviteDeps) {
  const guard = guardPrivateKeys(req);
  if (!guard.ok) return fail(guard.code);
  const v = await verifySignedRequest(req, deps.verify);
  if (!v.ok) return fail(v.error);
  if (v.request.action !== action) return fail("invalid_signature");
  return v.request;
}

function isFailure(x: unknown): x is InviteFailure {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}

export async function sendInvite(deps: InviteDeps, req: unknown): Promise<InviteResult<{ inviteId: string }>> {
  const r = await verified(req, "sendInvite", deps);
  if (isFailure(r)) return r;
  const payload = r.payload as { to?: unknown } | null;
  const target = payload && typeof payload === "object" ? payload.to : undefined;

  const formatOk = typeof target === "string" && PIN_REGEX.test(target);
  const t = formatOk ? (target as string) : "";
  const [exists, burned, linked] = formatOk
    ? await Promise.all([deps.repo.pinExists(t), deps.repo.isBurned(t), deps.repo.linked(r.pin, t)])
    : [false, false, false];
  const denied = decideInvite({
    senderPin: r.pin,
    target,
    targetExists: exists,
    targetBurned: burned,
    linked,
  });
  if (denied) return fail(denied, "to");

  // Quota lives in the sender's mailbox (Req 4.13); fail closed if unreachable.
  let quota: QuotaResult;
  try {
    quota = await deps.mailboxFor(r.pin).checkInviteQuota();
  } catch {
    return fail("verification_unavailable");
  }
  if (!quota.ok) return fail("rate_limited", undefined, Math.max(1, Math.ceil(quota.retryAfterMs / 1000)));

  const inserted = await deps.repo.insertInvite(r.pin, t);
  if (!inserted) return fail("duplicate", "to");

  try {
    await deps.mailboxFor(t).pushNotice({ type: "inviteNotice", kind: "invite", from: r.pin, inviteId: inserted.id });
  } catch {
    // The invite is persisted; the recipient still sees it via the directory on next sync.
    safeLog("invite_notice_failed");
  }
  return { ok: true, value: { inviteId: inserted.id } };
}

export async function respondInvite(
  deps: InviteDeps,
  req: unknown,
): Promise<InviteResult<{ accepted: boolean; contactPin: string }>> {
  const r = await verified(req, "respondInvite", deps);
  if (isFailure(r)) return r;
  const p = r.payload as { inviteId?: unknown; accept?: unknown } | null;
  const inviteId = p && typeof p === "object" ? p.inviteId : undefined;
  const accept = p && typeof p === "object" ? p.accept : undefined;
  if (typeof inviteId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(inviteId)) return fail("validation_failed", "inviteId");
  if (typeof accept !== "boolean") return fail("validation_failed", "accept");

  const invite = await deps.repo.getInvite(inviteId);
  // Only the invited PIN may respond; hide other invites behind not_found.
  if (!invite || invite.toPin !== r.pin) return fail("not_found", "inviteId");

  if (!accept) {
    await deps.repo.deleteInvite(inviteId);
    return { ok: true, value: { accepted: false, contactPin: invite.fromPin } };
  }

  if (!(await deps.repo.acceptInvite(inviteId))) return fail("not_found", "inviteId");

  // Best effort: the Directory is authoritative and the pair cache TTL bounds staleness.
  for (const pin of [invite.fromPin, invite.toPin]) {
    try {
      await deps.mailboxFor(pin).invalidatePairs();
    } catch {
      safeLog("invalidate_failed");
    }
  }
  try {
    await deps.mailboxFor(invite.fromPin).pushNotice({ type: "inviteNotice", kind: "accepted", from: invite.toPin });
  } catch {
    safeLog("invite_notice_failed");
  }
  return { ok: true, value: { accepted: true, contactPin: invite.fromPin } };
}

/** Drizzle-backed repository (Neon). */
export function createDrizzleInviteRepository(db: Db): InviteRepository {
  return {
    async pinExists(pin) {
      const rows = await db.select({ p: pins.pin }).from(pins).where(eq(pins.pin, pin)).limit(1);
      return rows.length > 0;
    },
    async isBurned(pin) {
      const rows = await db.select({ p: burnedPins.pin }).from(burnedPins).where(eq(burnedPins.pin, pin)).limit(1);
      return rows.length > 0;
    },
    async linked(a, b) {
      const inv = await db
        .select({ id: invites.id })
        .from(invites)
        .where(
          or(
            and(eq(invites.fromPin, a), eq(invites.toPin, b)),
            and(eq(invites.fromPin, b), eq(invites.toPin, a)),
          ),
        )
        .limit(1);
      if (inv.length > 0) return true;
      const [low, high] = orderPair(a, b);
      const c = await db
        .select({ l: contacts.pinLow })
        .from(contacts)
        .where(and(eq(contacts.pinLow, low), eq(contacts.pinHigh, high)))
        .limit(1);
      return c.length > 0;
    },
    async insertInvite(from, to) {
      const rows = await db
        .insert(invites)
        .values({ fromPin: from, toPin: to })
        .onConflictDoNothing()
        .returning({ id: invites.id });
      return rows[0] ? { id: rows[0].id } : null;
    },
    async getInvite(id) {
      const rows = await db
        .select({ id: invites.id, fromPin: invites.fromPin, toPin: invites.toPin })
        .from(invites)
        .where(eq(invites.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async acceptInvite(id) {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(invites).where(eq(invites.id, id)).returning();
        const inv = deleted[0];
        if (!inv) return false;
        const [low, high] = orderPair(inv.fromPin, inv.toPin);
        await tx.insert(contacts).values({ pinLow: low, pinHigh: high }).onConflictDoNothing();
        return true;
      });
    },
    async deleteInvite(id) {
      const rows = await db.delete(invites).where(eq(invites.id, id)).returning({ id: invites.id });
      return rows.length > 0;
    },
  };
}
