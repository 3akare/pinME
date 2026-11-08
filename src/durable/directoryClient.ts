import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../db/client";
import { burnedPins, contacts, pins } from "../db/schema";

/** What the Directory knows about a PIN. */
export type PinRecord =
  | { state: "active"; signPublicKey: string; boxPublicKey: string }
  | { state: "burned" }
  | { state: "unknown" };

/** Read-only Directory access used by PinMailbox. Injectable for tests. */
export interface DirectoryClient {
  /** Key and burned lookup in one call. Throws when the Directory is unreachable. */
  lookupPin(pin: string): Promise<PinRecord>;
  /** Whether an accepted Contact pair exists. Throws when the Directory is unreachable. */
  isContactPair(a: string, b: string): Promise<boolean>;
}

/** Drizzle-backed Directory client. */
export function createDirectoryClient(db: Db): DirectoryClient {
  return {
    async lookupPin(pin) {
      const burned = await db
        .select({ pin: burnedPins.pin })
        .from(burnedPins)
        .where(eq(burnedPins.pin, pin))
        .limit(1);
      if (burned.length > 0) return { state: "burned" };
      const rows = await db
        .select({ sign: pins.signPublicKey, box: pins.boxPublicKey })
        .from(pins)
        .where(eq(pins.pin, pin))
        .limit(1);
      const row = rows[0];
      if (!row) return { state: "unknown" };
      return { state: "active", signPublicKey: row.sign, boxPublicKey: row.box };
    },
    async isContactPair(a, b) {
      const [low, high] = a < b ? [a, b] : [b, a];
      const rows = await db
        .select({ low: contacts.pinLow })
        .from(contacts)
        .where(and(eq(contacts.pinLow, low), eq(contacts.pinHigh, high)))
        .limit(1);
      return rows.length > 0;
    },
  };
}

/** Creates a fresh client per use (Workers forbid sharing I/O objects across requests). */
export function createDirectoryClientFromEnv(env: { DATABASE_URL?: string | null }): DirectoryClient {
  return createDirectoryClient(createDb(env));
}
