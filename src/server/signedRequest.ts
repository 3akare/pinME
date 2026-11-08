/**
 * Signed_Request verification (Req 19.1, 19.3-19.7, 19.9, 11.4, 11.5).
 *
 * Check order: shape, PIN exists and active (burn on a burned PIN is the
 * no-op exception), timestamp skew, nonce unused, Ed25519 signature. The nonce
 * is recorded only after every other check has passed.
 */

import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { burnedPins, pins, usedNonces } from "../db/schema";
import { canonicalize } from "../shared/canonical";
import { verifyEd25519Base64 } from "../shared/ed25519";
import { NONCE_WINDOW_MS, SIGNED_REQUEST_SKEW_MS } from "../shared/limits";
import { SignedRequestSchema, type SignedRequest } from "../shared/signed";

export type SignedRequestErrorCategory =
  | "invalid_signature"
  | "expired_timestamp"
  | "replay"
  | "unknown_pin";

export type VerifyResult =
  | {
      ok: true;
      request: SignedRequest;
      /** True when the PIN is already burned (only for the burn action: no-op success). */
      alreadyBurned: boolean;
    }
  | { ok: false; error: SignedRequestErrorCategory };

export interface KeyRecord {
  signPublicKey: string; // base64 Ed25519
  burned: boolean;
}

export interface NonceStore {
  /** Atomically record the nonce. Returns false if it was already used within the window. */
  claim(pin: string, nonce: string, nowMs: number): Promise<boolean>;
}

export interface VerifyDeps {
  now: () => number;
  lookupKey: (pin: string) => Promise<KeyRecord | null>;
  nonceStore: NonceStore;
}

export async function verifySignedRequest(req: unknown, deps: VerifyDeps): Promise<VerifyResult> {
  // 1. shape
  const parsed = SignedRequestSchema.safeParse(req);
  if (!parsed.success) return { ok: false, error: "invalid_signature" };
  const request = parsed.data;

  // 2. PIN exists and is active
  const record = await deps.lookupKey(request.pin);
  if (!record) return { ok: false, error: "unknown_pin" };
  const alreadyBurned = record.burned;
  if (alreadyBurned && request.action !== "burn") return { ok: false, error: "unknown_pin" };

  // 3. timestamp within +-60 s
  const now = deps.now();
  if (Math.abs(now - request.ts) > SIGNED_REQUEST_SKEW_MS) {
    return { ok: false, error: "expired_timestamp" };
  }

  // 4. cheap non-recording replay is deferred to the atomic claim below; the
  //    signature is checked first so unauthenticated callers cannot burn nonces.
  let message: Uint8Array;
  try {
    message = canonicalize({
      pin: request.pin,
      action: request.action,
      ts: request.ts,
      nonce: request.nonce,
      payload: request.payload,
    });
  } catch {
    return { ok: false, error: "invalid_signature" };
  }
  const valid = await verifyEd25519Base64(record.signPublicKey, message, request.signature);
  if (!valid) return { ok: false, error: "invalid_signature" };

  // 5. nonce: recorded last, atomically (concurrent replays lose)
  const fresh = await deps.nonceStore.claim(request.pin, request.nonce, now);
  if (!fresh) return { ok: false, error: "replay" };

  return { ok: true, request, alreadyBurned };
}

/** Drizzle-backed nonce store using INSERT ... ON CONFLICT DO NOTHING. */
export function createNonceStore(db: Db): NonceStore {
  return {
    async claim(pin, nonce, nowMs) {
      // Opportunistic purge of entries older than the replay window.
      await db.delete(usedNonces).where(lt(usedNonces.usedAt, new Date(nowMs - NONCE_WINDOW_MS)));
      const inserted = await db
        .insert(usedNonces)
        .values({ pin, nonce, usedAt: new Date(nowMs) })
        .onConflictDoNothing()
        .returning({ nonce: usedNonces.nonce });
      return inserted.length > 0;
    },
  };
}

/** Drizzle-backed key lookup: active pins first, then retained burned keys. */
export function createKeyLookup(db: Db): VerifyDeps["lookupKey"] {
  return async (pin) => {
    const active = await db
      .select({ signPublicKey: pins.signPublicKey })
      .from(pins)
      .where(eq(pins.pin, pin))
      .limit(1);
    if (active[0]) return { signPublicKey: active[0].signPublicKey, burned: false };
    const burned = await db
      .select({ signPublicKey: burnedPins.signPublicKey })
      .from(burnedPins)
      .where(and(eq(burnedPins.pin, pin)))
      .limit(1);
    if (burned[0]) return { signPublicKey: burned[0].signPublicKey, burned: true };
    return null;
  };
}

export function createVerifyDeps(db: Db, now: () => number = Date.now): VerifyDeps {
  return { now, lookupKey: createKeyLookup(db), nonceStore: createNonceStore(db) };
}
