/**
 * Profile service (Req 11.3-11.6, 11.9, 19.1).
 *
 * Pure over injectable collaborators: a `ProfileRepository` (Directory), a
 * `ProfileMailboxFor` factory (PinMailbox RPC stubs) and `verifySignedRequest` deps.
 *
 * Contract for task 11.2 (PinMailbox): implement the RPC method
 * `pushPresence(notice: PresenceNoticeInput)`. It must retain the latest
 * presence per `notice.from` under a replaceable key, push it to connected
 * sockets immediately, and deliver it after the next authentication.
 * Presence is NOT sent through `pushNotice` (which only accepts invite/accepted).
 */
import { eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { contacts, pins } from "../db/schema";
import { safeLog } from "../shared/safeLog";
import type { ErrorCode } from "../shared/protocol";
import { isValidDisplayName, isValidPersonalMessage } from "../shared/validation";
import { guardPrivateKeys } from "./guard";
import { verifySignedRequest, type VerifyDeps } from "./signedRequest";

export type PresenceStatus = "available" | "busy";

export interface ProfileUpdate {
  status?: PresenceStatus;
  personalMessage?: string;
  displayName?: string;
}

export interface ProfileRepository {
  /** Updates only the provided fields. Returns false if the PIN row does not exist. */
  updateProfile(pin: string, update: ProfileUpdate): Promise<boolean>;
  /** Current stored presence values for the PIN (used to fill unchanged fields in the push). */
  getProfile(pin: string): Promise<{ status: PresenceStatus; personalMessage: string } | null>;
  /** PINs of every Contact of `pin`. */
  listContacts(pin: string): Promise<string[]>;
}

export interface PresenceNoticeInput {
  type: "inviteNotice";
  kind: "presence";
  from: string;
  status: PresenceStatus;
  personalMessage: string;
}

/** The PinMailbox RPC surface used here (to be implemented by task 11.2). */
export interface ProfileMailbox {
  pushPresence(notice: PresenceNoticeInput): Promise<unknown>;
}

export type ProfileMailboxFor = (pin: string) => ProfileMailbox;

export interface ProfileDeps {
  repo: ProfileRepository;
  mailboxFor: ProfileMailboxFor;
  verify: VerifyDeps;
}

export type ProfileFailure = { ok: false; code: ErrorCode; field?: string };
export type ProfileResult<T> = { ok: true; value: T } | ProfileFailure;

function fail(code: ErrorCode, field?: string): ProfileFailure {
  safeLog("profile_rejected", { code, field });
  const out: ProfileFailure = { ok: false, code };
  if (field !== undefined) out.field = field;
  return out;
}

/**
 * Pure payload validation. Rejects unknown keys, an empty update, bad status,
 * a personal message over 80 characters (field "personalMessage") and bad display names.
 */
export function validateProfilePayload(
  payload: unknown,
): { ok: true; update: ProfileUpdate } | { ok: false; field: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, field: "payload" };
  }
  const p = payload as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (k !== "status" && k !== "personalMessage" && k !== "displayName") return { ok: false, field: "payload" };
  }
  const update: ProfileUpdate = {};
  if (p.status !== undefined) {
    if (p.status !== "available" && p.status !== "busy") return { ok: false, field: "status" };
    update.status = p.status;
  }
  if (p.personalMessage !== undefined) {
    if (!isValidPersonalMessage(p.personalMessage)) return { ok: false, field: "personalMessage" };
    update.personalMessage = p.personalMessage as string;
  }
  if (p.displayName !== undefined) {
    if (!isValidDisplayName(p.displayName)) return { ok: false, field: "displayName" };
    update.displayName = (p.displayName as string).trim();
  }
  if (Object.keys(update).length === 0) return { ok: false, field: "payload" };
  return { ok: true, update };
}

export async function updateProfile(
  deps: ProfileDeps,
  req: unknown,
): Promise<ProfileResult<{ status: PresenceStatus; personalMessage: string }>> {
  const guard = guardPrivateKeys(req);
  if (!guard.ok) return fail(guard.code);
  // Verify before touching the Directory (Req 11.4, 11.5).
  const v = await verifySignedRequest(req, deps.verify);
  if (!v.ok) return fail(v.error);
  if (v.request.action !== "updateProfile") return fail("invalid_signature");

  const parsed = validateProfilePayload(v.request.payload);
  if (!parsed.ok) return fail("validation_failed", parsed.field);

  const pin = v.request.pin;
  if (!(await deps.repo.updateProfile(pin, parsed.update))) return fail("unknown_pin");

  const current = await deps.repo.getProfile(pin);
  const status = current?.status ?? parsed.update.status ?? "available";
  const personalMessage = current?.personalMessage ?? parsed.update.personalMessage ?? "";

  // Best-effort fan-out to every contact's mailbox; the Directory is authoritative.
  let contactPins: string[] = [];
  try {
    contactPins = await deps.repo.listContacts(pin);
  } catch {
    safeLog("presence_push_failed");
  }
  const notice: PresenceNoticeInput = { type: "inviteNotice", kind: "presence", from: pin, status, personalMessage };
  await Promise.all(
    contactPins.map(async (c) => {
      try {
        await deps.mailboxFor(c).pushPresence(notice);
      } catch {
        safeLog("presence_push_failed");
      }
    }),
  );
  return { ok: true, value: { status, personalMessage } };
}

/** Drizzle-backed repository (Neon). */
export function createDrizzleProfileRepository(db: Db): ProfileRepository {
  return {
    async updateProfile(pin, update) {
      const rows = await db.update(pins).set(update).where(eq(pins.pin, pin)).returning({ p: pins.pin });
      return rows.length > 0;
    },
    async getProfile(pin) {
      const rows = await db
        .select({ status: pins.status, personalMessage: pins.personalMessage })
        .from(pins)
        .where(eq(pins.pin, pin))
        .limit(1);
      return rows[0] ?? null;
    },
    async listContacts(pin) {
      const rows = await db
        .select({ low: contacts.pinLow, high: contacts.pinHigh })
        .from(contacts)
        .where(or(eq(contacts.pinLow, pin), eq(contacts.pinHigh, pin)));
      return rows.map((r) => (r.low === pin ? r.high : r.low));
    },
  };
}
