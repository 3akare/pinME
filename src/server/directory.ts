import { eq } from "drizzle-orm";
import { z } from "zod";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "../db/schema";
import { burnedPins, pins } from "../db/schema";
import { decodedLength } from "../shared/base64";
import { DISPLAY_NAME_MAX, PERSONAL_MESSAGE_MAX } from "../shared/limits";
import { PIN_REGEX } from "../shared/pin";
import type { ErrorCode } from "../shared/protocol";
import { safeLog } from "../shared/safeLog";
import { guardPrivateKeys } from "./guard";

export type PinStatus = "available" | "busy";

/** Public record of a PIN. Contains only public data (Req 17.1). */
export interface PinRecord {
  pin: string;
  boxPublicKey: string;
  signPublicKey: string;
  displayName: string;
  status: PinStatus;
  personalMessage: string;
}

/** Injectable persistence interface for the directory service. */
export interface DirectoryRepository {
  getPin(pin: string): Promise<PinRecord | null>;
  isBurned(pin: string): Promise<boolean>;
  /** Inserts the record. Returns false (and changes nothing) if the PIN already exists. */
  insertPin(record: PinRecord): Promise<boolean>;
}

export type DirectoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; field?: string };

const b64Key = z
  .string()
  .regex(/^[A-Za-z0-9+/_-]+={0,2}$/)
  .refine((s) => decodedLength(s) === 32);

const RegisterInput = z.strictObject({
  pin: z.string().regex(PIN_REGEX),
  boxPublicKey: b64Key,
  signPublicKey: b64Key,
  displayName: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 1 && s.length <= DISPLAY_NAME_MAX),
  status: z.enum(["available", "busy"]).default("available"),
  personalMessage: z.string().max(PERSONAL_MESSAGE_MAX).default(""),
});

function fail(code: ErrorCode, field?: string): { ok: false; code: ErrorCode; field?: string } {
  safeLog("directory_rejected", { code, field });
  return field === undefined ? { ok: false, code } : { ok: false, code, field };
}

/**
 * Registers a PIN with its public keys. Rejects bodies carrying private-key
 * fields first, then validates, then rejects PINs present in `pins` or
 * `burned_pins`. On any failure nothing is written.
 */
export async function registerPin(
  repo: DirectoryRepository,
  body: unknown,
): Promise<DirectoryResult<PinRecord>> {
  const guard = guardPrivateKeys(body);
  if (!guard.ok) return { ok: false, code: guard.code };

  const parsed = RegisterInput.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return fail("validation_failed", typeof field === "string" ? field : undefined);
  }
  const record: PinRecord = parsed.data;

  if (await repo.isBurned(record.pin)) return fail("collision", "pin");
  if ((await repo.getPin(record.pin)) !== null) return fail("collision", "pin");
  // The insert itself must also refuse a concurrent duplicate.
  if (!(await repo.insertPin(record))) return fail("collision", "pin");
  return { ok: true, value: record };
}

/** Returns the public profile of an existing PIN (Req 2.8). */
export async function getPublicProfile(
  repo: DirectoryRepository,
  pin: unknown,
): Promise<DirectoryResult<PinRecord>> {
  if (typeof pin !== "string" || !PIN_REGEX.test(pin)) return fail("validation_failed", "pin");
  const record = await repo.getPin(pin);
  if (record) return { ok: true, value: record };
  if (await repo.isBurned(pin)) return fail("pin_burned", "pin");
  return fail("not_found", "pin");
}

/** Drizzle-backed repository (Neon). */
/** Structurally identical to `Db` from src/db/client. */
type DirectoryDb = NeonDatabase<typeof schema>;

export function createDrizzleDirectoryRepository(db: DirectoryDb): DirectoryRepository {
  return {
    async getPin(pin) {
      const rows = await db.select().from(pins).where(eq(pins.pin, pin)).limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        pin: r.pin,
        boxPublicKey: r.boxPublicKey,
        signPublicKey: r.signPublicKey,
        displayName: r.displayName,
        status: r.status,
        personalMessage: r.personalMessage,
      };
    },
    async isBurned(pin) {
      const rows = await db
        .select({ pin: burnedPins.pin })
        .from(burnedPins)
        .where(eq(burnedPins.pin, pin))
        .limit(1);
      return rows.length > 0;
    },
    async insertPin(record) {
      const rows = await db
        .insert(pins)
        .values(record)
        .onConflictDoNothing()
        .returning({ pin: pins.pin });
      return rows.length > 0;
    },
  };
}
