/**
 * Group chats (stretch). A group is a set of PINs that may relay messages to each other. Only the
 * creator's accepted Contacts can be added, so nobody is put in a group by a stranger. What a group
 * is called and what is said in it never reach the server: names and texts travel encrypted.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { burnedPins, contacts, groupMembers, groups } from "../db/schema";
import { MAX_GROUP_MEMBERS } from "../shared/limits";
import { PIN_REGEX } from "../shared/pin";
import type { ErrorCode } from "../shared/protocol";
import { safeLog } from "../shared/safeLog";
import { guardPrivateKeys } from "./guard";
import { verifySignedRequest, type VerifyDeps } from "./signedRequest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GroupRepository {
  /** PINs among `others` that are accepted Contacts of `pin` and not burned. */
  contactsOf(pin: string, others: string[]): Promise<string[]>;
  /** Inserts the group with its members; false when the id is taken. */
  create(groupId: string, createdBy: string, members: string[]): Promise<boolean>;
  members(groupId: string): Promise<string[]>;
  /** Removes one member; the group goes when its last member leaves. */
  leave(groupId: string, pin: string): Promise<boolean>;
}

export interface GroupMailbox {
  invalidatePairs(): Promise<void> | void;
}

export interface GroupDeps {
  repo: GroupRepository;
  verify: VerifyDeps;
  mailboxFor: (pin: string) => GroupMailbox;
}

export type GroupResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; field?: string };

function fail<T>(code: ErrorCode, field?: string): GroupResult<T> {
  safeLog("group_rejected", { code, field });
  return field === undefined ? { ok: false, code } : { ok: false, code, field };
}

async function verified(req: unknown, action: "createGroup" | "leaveGroup", deps: GroupDeps) {
  const guard = guardPrivateKeys(req);
  if (!guard.ok) return { error: guard.code } as const;
  const v = await verifySignedRequest(req, deps.verify);
  if (!v.ok) return { error: v.error } as const;
  if (v.request.action !== action) return { error: "invalid_signature" as const };
  return { request: v.request } as const;
}

/** Cached relay verdicts would let a stale "no" (or "yes") stand; drop them for everyone involved. */
async function invalidate(deps: GroupDeps, pins: string[]): Promise<void> {
  await Promise.all(
    pins.map(async (p) => {
      try {
        await deps.mailboxFor(p).invalidatePairs();
      } catch {
        safeLog("invalidate_failed");
      }
    }),
  );
}

/** Signed `createGroup` with payload `{ groupId, members }`; the signer becomes a member too. */
export async function createGroup(deps: GroupDeps, req: unknown): Promise<GroupResult<{ groupId: string; members: string[] }>> {
  const v = await verified(req, "createGroup", deps);
  if ("error" in v) return fail(v.error!);
  const creator = v.request.pin;
  const p = v.request.payload as { groupId?: unknown; members?: unknown } | null;
  if (!p || typeof p !== "object" || Object.keys(p).some((k) => k !== "groupId" && k !== "members")) {
    return fail("validation_failed", "payload");
  }
  if (typeof p.groupId !== "string" || !UUID.test(p.groupId)) return fail("validation_failed", "groupId");
  const members = p.members;
  if (
    !Array.isArray(members) ||
    members.length < 1 ||
    members.length > MAX_GROUP_MEMBERS - 1 ||
    !members.every((m): m is string => typeof m === "string" && PIN_REGEX.test(m)) ||
    new Set(members).size !== members.length ||
    members.includes(creator)
  ) {
    return fail("validation_failed", "members");
  }
  const allowed = new Set(await deps.repo.contactsOf(creator, members));
  if (!members.every((m) => allowed.has(m))) return fail("not_a_contact", "members");
  if (!(await deps.repo.create(p.groupId, creator, [creator, ...members]))) return fail("duplicate", "groupId");
  await invalidate(deps, [creator, ...members]);
  return { ok: true, value: { groupId: p.groupId, members: [creator, ...members] } };
}

/** Signed `leaveGroup` with payload `{ groupId }`. */
export async function leaveGroup(deps: GroupDeps, req: unknown): Promise<GroupResult<{ left: boolean }>> {
  const v = await verified(req, "leaveGroup", deps);
  if ("error" in v) return fail(v.error!);
  const p = v.request.payload as { groupId?: unknown } | null;
  if (!p || typeof p !== "object" || Object.keys(p).some((k) => k !== "groupId")) return fail("validation_failed", "payload");
  if (typeof p.groupId !== "string" || !UUID.test(p.groupId)) return fail("validation_failed", "groupId");
  const before = await deps.repo.members(p.groupId);
  if (!before.includes(v.request.pin)) return fail("not_found", "groupId");
  await deps.repo.leave(p.groupId, v.request.pin);
  await invalidate(deps, before);
  return { ok: true, value: { left: true } };
}

/** Drizzle-backed repository (Neon). */
export function createDrizzleGroupRepository(db: Db): GroupRepository {
  return {
    async contactsOf(pin, others) {
      if (others.length === 0) return [];
      const rows = await db
        .select({ low: contacts.pinLow, high: contacts.pinHigh })
        .from(contacts)
        .where(
          or(
            and(eq(contacts.pinLow, pin), inArray(contacts.pinHigh, others)),
            and(eq(contacts.pinHigh, pin), inArray(contacts.pinLow, others)),
          ),
        );
      const found = rows.map((r) => (r.low === pin ? r.high : r.low));
      if (found.length === 0) return [];
      const burned = await db.select({ pin: burnedPins.pin }).from(burnedPins).where(inArray(burnedPins.pin, found));
      const gone = new Set(burned.map((b) => b.pin));
      return found.filter((f) => !gone.has(f));
    },
    async create(groupId, createdBy, members) {
      return db.transaction(async (tx) => {
        const inserted = await tx.insert(groups).values({ id: groupId, createdBy }).onConflictDoNothing().returning({ id: groups.id });
        if (inserted.length === 0) return false;
        await tx.insert(groupMembers).values(members.map((pin) => ({ groupId, pin })));
        return true;
      });
    },
    async members(groupId) {
      const rows = await db.select({ pin: groupMembers.pin }).from(groupMembers).where(eq(groupMembers.groupId, groupId));
      return rows.map((r) => r.pin);
    },
    async leave(groupId, pin) {
      return db.transaction(async (tx) => {
        const removed = await tx
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.pin, pin)))
          .returning({ pin: groupMembers.pin });
        const left = await tx.select({ pin: groupMembers.pin }).from(groupMembers).where(eq(groupMembers.groupId, groupId)).limit(1);
        if (left.length === 0) await tx.delete(groups).where(eq(groups.id, groupId));
        return removed.length > 0;
      });
    },
  };
}
