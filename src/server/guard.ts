import { safeLog } from "../shared/safeLog";

/** Key names that may indicate private key material (Req 17.6). */
export const FORBIDDEN_KEY_PATTERN = /priv|secret/i;

const MAX_DEPTH = 32;

export type GuardResult =
  | { ok: true }
  | { ok: false; code: "private_key_not_accepted" | "validation_failed" };

function containsForbiddenKey(value: unknown, depth: number): boolean | "too_deep" {
  if (value === null || typeof value !== "object") return false;
  if (depth > MAX_DEPTH) return "too_deep";
  if (Array.isArray(value)) {
    for (const item of value) {
      const r = containsForbiddenKey(item, depth + 1);
      if (r) return r;
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) return true;
    const r = containsForbiddenKey((value as Record<string, unknown>)[key], depth + 1);
    if (r) return r;
  }
  return false;
}

/**
 * Recursively rejects any body with a key name matching /priv|secret/i.
 * Must run before any persistence or logging of the body. Only the rejection
 * code is logged, never the key name or value. Fails closed on excessive nesting.
 */
export function guardPrivateKeys(body: unknown): GuardResult {
  const r = containsForbiddenKey(body, 0);
  if (r === true) {
    safeLog("guard_rejected", { code: "private_key_not_accepted" });
    return { ok: false, code: "private_key_not_accepted" };
  }
  if (r === "too_deep") {
    safeLog("guard_rejected", { code: "validation_failed" });
    return { ok: false, code: "validation_failed" };
  }
  return { ok: true };
}
