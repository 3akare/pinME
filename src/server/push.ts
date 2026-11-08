/**
 * Push registration (stretch: installable PWA with push). A PIN stores at most one push endpoint,
 * in its own mailbox. Each PIN registers from its own service-worker scope, so the endpoints of
 * one person's PINs differ and nothing here links them.
 */
import type { ErrorCode } from "../shared/protocol";
import { isPushEndpoint } from "../shared/push";
import { safeLog } from "../shared/safeLog";
import { guardPrivateKeys } from "./guard";
import { verifySignedRequest, type VerifyDeps } from "./signedRequest";

export interface PushMailbox {
  setPushEndpoint(endpoint: string | null): Promise<{ ok: boolean }>;
}

export interface PushDeps {
  verify: VerifyDeps;
  mailboxFor: (pin: string) => PushMailbox;
}

export type PushResult = { ok: true; value: { registered: boolean } } | { ok: false; code: ErrorCode; field?: string };

function fail(code: ErrorCode, field?: string): PushResult {
  safeLog("push_rejected", { code, field });
  return field === undefined ? { ok: false, code } : { ok: false, code, field };
}

/** Signed `registerPush` with payload `{ endpoint }`; `endpoint: null` turns pushes off. */
export async function registerPush(deps: PushDeps, req: unknown): Promise<PushResult> {
  const guard = guardPrivateKeys(req);
  if (!guard.ok) return fail(guard.code);
  const v = await verifySignedRequest(req, deps.verify);
  if (!v.ok) return fail(v.error);
  if (v.request.action !== "registerPush") return fail("invalid_signature");

  const p = v.request.payload as { endpoint?: unknown } | null;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => k !== "endpoint")) {
    return fail("validation_failed", "payload");
  }
  const endpoint = p.endpoint;
  if (endpoint !== null && !isPushEndpoint(endpoint)) return fail("validation_failed", "endpoint");

  try {
    await deps.mailboxFor(v.request.pin).setPushEndpoint(endpoint);
  } catch {
    return fail("verification_unavailable");
  }
  return { ok: true, value: { registered: endpoint !== null } };
}
