/**
 * Prekeys for forward secrecy (X3DH). Each PIN keeps its public prekeys in its own mailbox: one
 * signed prekey and up to MAX_OPKS one-time prekeys. Only a Contact or group-mate may take a
 * bundle, so strangers cannot drain the one-time keys or probe who is reachable.
 */
import type { ErrorCode } from "../shared/protocol";
import { decodedLength } from "../shared/base64";
import { PIN_REGEX } from "../shared/pin";
import { safeLog } from "../shared/safeLog";
import { guardPrivateKeys } from "./guard";
import { verifySignedRequest, type VerifyDeps } from "./signedRequest";

export const MAX_OPKS = 100;
const MAX_UPLOAD = 50;
const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

export interface PublicPrekey {
  id: number;
  pub: string;
}
export interface SignedPrekey extends PublicPrekey {
  sig: string;
}
export interface PrekeyBundle {
  spk: SignedPrekey;
  opk?: PublicPrekey;
}

export interface PrekeyMailbox {
  putPrekeys(input: { spk?: SignedPrekey; opks: PublicPrekey[] }): Promise<{ opkCount: number }>;
  takePrekeyBundle(): Promise<PrekeyBundle | null>;
}

export interface PrekeyDeps {
  verify: VerifyDeps;
  mailboxFor: (pin: string) => PrekeyMailbox;
  /** Contacts or members of a shared group. Throws when the Directory is unreachable. */
  mayRelay: (a: string, b: string) => Promise<boolean>;
}

export type PrekeyResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; field?: string };

function fail<T>(code: ErrorCode, field?: string): PrekeyResult<T> {
  safeLog("prekey_rejected", { code, field });
  return field === undefined ? { ok: false, code } : { ok: false, code, field };
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 0xffffffff;
const isKey = (v: unknown, bytes: number) => typeof v === "string" && B64.test(v) && decodedLength(v) === bytes;
const isPublic = (v: unknown): v is PublicPrekey =>
  !!v && typeof v === "object" && isId((v as PublicPrekey).id) && isKey((v as PublicPrekey).pub, 32);
const isSigned = (v: unknown): v is SignedPrekey => isPublic(v) && isKey((v as SignedPrekey).sig, 64);

async function verified(req: unknown, action: "publishPrekeys" | "getPrekeys", deps: PrekeyDeps) {
  const guard = guardPrivateKeys(req);
  if (!guard.ok) return { error: guard.code } as const;
  const v = await verifySignedRequest(req, deps.verify);
  if (!v.ok) return { error: v.error } as const;
  if (v.request.action !== action) return { error: "invalid_signature" as const };
  return { request: v.request } as const;
}

/** Signed `publishPrekeys` with `{ spk?, opks }`; answers how many one-time keys are now held. */
export async function publishPrekeys(deps: PrekeyDeps, req: unknown): Promise<PrekeyResult<{ opkCount: number }>> {
  const v = await verified(req, "publishPrekeys", deps);
  if ("error" in v) return fail(v.error!);
  const p = v.request.payload as { spk?: unknown; opks?: unknown } | null;
  if (!p || typeof p !== "object" || Object.keys(p).some((k) => k !== "spk" && k !== "opks")) return fail("validation_failed", "payload");
  if (p.spk !== undefined && !isSigned(p.spk)) return fail("validation_failed", "spk");
  if (!Array.isArray(p.opks) || p.opks.length > MAX_UPLOAD || !p.opks.every(isPublic)) return fail("validation_failed", "opks");
  const input = { opks: (p.opks as PublicPrekey[]).map(({ id, pub }) => ({ id, pub })) } as { spk?: SignedPrekey; opks: PublicPrekey[] };
  if (p.spk) {
    const { id, pub, sig } = p.spk as SignedPrekey;
    input.spk = { id, pub, sig };
  }
  try {
    return { ok: true, value: await deps.mailboxFor(v.request.pin).putPrekeys(input) };
  } catch {
    return fail("verification_unavailable");
  }
}

/** Signed `getPrekeys` with `{ pin }`: one bundle for starting a session, if the PIN published any. */
export async function getPrekeys(deps: PrekeyDeps, req: unknown): Promise<PrekeyResult<PrekeyBundle | null>> {
  const v = await verified(req, "getPrekeys", deps);
  if ("error" in v) return fail(v.error!);
  const p = v.request.payload as { pin?: unknown } | null;
  if (!p || typeof p !== "object" || Object.keys(p).some((k) => k !== "pin")) return fail("validation_failed", "payload");
  if (typeof p.pin !== "string" || !PIN_REGEX.test(p.pin)) return fail("validation_failed", "pin");
  let allowed: boolean;
  try {
    allowed = await deps.mayRelay(v.request.pin, p.pin);
  } catch {
    return fail("verification_unavailable");
  }
  if (!allowed) return fail("not_a_contact", "pin");
  try {
    return { ok: true, value: await deps.mailboxFor(p.pin).takePrekeyBundle() };
  } catch {
    return fail("verification_unavailable");
  }
}
