/**
 * Burn service (Req 13.3, 13.4, 13.6, 13.9, 13.12, 13.14-13.16).
 *
 * Pure over injectable collaborators: a `BurnRepository` (Directory), a
 * `BurnMailboxFor` factory (PinMailbox RPC stubs) and `verifySignedRequest` deps.
 */
import { eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { burnedPins, contacts, groupMembers, invites, pins } from "../db/schema";
import type { ErrorCode } from "../shared/protocol";
import { safeLog } from "../shared/safeLog";
import { guardPrivateKeys } from "./guard";
import { verifySignedRequest, type VerifyDeps } from "./signedRequest";

export interface BurnRepository {
  /**
   * One transaction: insert `burned_pins` (copying the sign public key), delete the
   * `pins` row, delete invites and contacts involving `pin`. Former contacts are
   * collected before deletion. Returns null if the PIN was not active (already burned).
   */
  burnPin(pin: string): Promise<{ formerContacts: string[] } | null>;
}

/** The PinMailbox RPC surface used here. */
export interface BurnMailbox {
  burn(): Promise<unknown>;
  contactBurned(pin: string): Promise<unknown>;
}

export type BurnMailboxFor = (pin: string) => BurnMailbox;

export interface BurnDeps {
  repo: BurnRepository;
  mailboxFor: BurnMailboxFor;
  verify: VerifyDeps;
}

export type BurnFailure = { ok: false; code: ErrorCode; field?: string };
export type BurnResult = { ok: true; value: { pin: string; alreadyBurned: boolean } } | BurnFailure;

function fail(code: ErrorCode): BurnFailure {
  safeLog("burn_rejected", { code });
  return { ok: false, code };
}

export async function burnPin(deps: BurnDeps, req: unknown): Promise<BurnResult> {
  const guard = guardPrivateKeys(req);
  if (!guard.ok) return fail(guard.code);
  // Ownership proof is required even for an already-burned PIN (Req 13.16).
  const v = await verifySignedRequest(req, deps.verify);
  if (!v.ok) return fail(v.error);
  if (v.request.action !== "burn") return fail("invalid_signature");

  const pin = v.request.pin;
  // Verified burn on an already-burned PIN: no-op success.
  if (v.alreadyBurned) return { ok: true, value: { pin, alreadyBurned: true } };

  const result = await deps.repo.burnPin(pin);
  if (!result) {
    // Lost a race with a concurrent burn of the same PIN: still a no-op success.
    return { ok: true, value: { pin, alreadyBurned: true } };
  }

  // Best effort side effects; the Directory is authoritative.
  try {
    await deps.mailboxFor(pin).burn();
  } catch {
    safeLog("mailbox_burn_failed");
  }
  await Promise.all(
    result.formerContacts.map(async (c) => {
      try {
        await deps.mailboxFor(c).contactBurned(pin);
      } catch {
        safeLog("contact_burned_notify_failed");
      }
    }),
  );
  return { ok: true, value: { pin, alreadyBurned: false } };
}

/** Drizzle-backed repository (Neon). */
export function createDrizzleBurnRepository(db: Db): BurnRepository {
  return {
    async burnPin(pin) {
      return db.transaction(async (tx) => {
        const removed = await tx.delete(pins).where(eq(pins.pin, pin)).returning({ key: pins.signPublicKey });
        const row = removed[0];
        if (!row) return null;
        await tx.insert(burnedPins).values({ pin, signPublicKey: row.key }).onConflictDoNothing();
        const rows = await tx
          .select({ low: contacts.pinLow, high: contacts.pinHigh })
          .from(contacts)
          .where(or(eq(contacts.pinLow, pin), eq(contacts.pinHigh, pin)));
        const formerContacts = rows.map((r) => (r.low === pin ? r.high : r.low));
        await tx.delete(contacts).where(or(eq(contacts.pinLow, pin), eq(contacts.pinHigh, pin)));
        await tx.delete(invites).where(or(eq(invites.fromPin, pin), eq(invites.toPin, pin)));
        // A burned PIN leaves every group, so group-mates can no longer relay to it.
        await tx.delete(groupMembers).where(eq(groupMembers.pin, pin));
        return { formerContacts };
      });
    },
  };
}
