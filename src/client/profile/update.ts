import { bytesToBase64 } from "../../shared/base64";
import type { ErrorCode } from "../../shared/protocol";
import type { SignedRequest } from "../../shared/signed";
import { isValidPersonalMessage } from "../../shared/validation";
import type { PinRecord, Repositories } from "../storage";

export type Presence = "available" | "busy";
export interface ProfileChange {
  status?: Presence;
  personalMessage?: string;
}
export type UpdateResult =
  | { ok: true; status: Presence; personalMessage: string }
  | { ok: false; code: ErrorCode | "timeout" | "network_error"; field?: string };

type ServerResult =
  | { ok: true; value: { status: Presence; personalMessage: string } }
  | { ok: false; code: ErrorCode; field?: string };

export interface ProfileUpdaterDeps {
  repos: Pick<Repositories, "pinRepo">;
  signRequest: (fields: Omit<SignedRequest, "signature">, signSk: Uint8Array) => Uint8Array;
  randomBytes: (n: number) => Uint8Array;
  /** Wrapper over `updateProfileFn({ data })`. */
  updateProfileFn: (req: SignedRequest) => Promise<ServerResult>;
  /** Mirrors a saved PIN record into the state store. */
  onSaved?: (pin: PinRecord) => void;
  now?: () => number;
  /** Request timeout in ms (Req 11.3: 2 s). */
  timeoutMs?: number;
}

export const PROFILE_TIMEOUT_MS = 2000;

/**
 * Signs and sends an `updateProfile` request. New values are persisted to the
 * PIN record only on success; on any failure the last saved values stay (Req 11.10).
 */
export function createProfileUpdater(deps: ProfileUpdaterDeps) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? PROFILE_TIMEOUT_MS;

  return async function updateOwnProfile(ownPin: string, change: ProfileChange): Promise<UpdateResult> {
    if (change.personalMessage !== undefined && !isValidPersonalMessage(change.personalMessage)) {
      return { ok: false, code: "validation_failed", field: "personalMessage" };
    }
    if (change.status !== undefined && change.status !== "available" && change.status !== "busy") {
      return { ok: false, code: "validation_failed", field: "status" };
    }
    const payload: ProfileChange = {};
    if (change.status !== undefined) payload.status = change.status;
    if (change.personalMessage !== undefined) payload.personalMessage = change.personalMessage;
    if (Object.keys(payload).length === 0) return { ok: false, code: "validation_failed", field: "payload" };

    const own = await deps.repos.pinRepo.get(ownPin);
    if (!own || own.status !== "active") return { ok: false, code: "unknown_pin" };

    const fields = {
      pin: own.pin,
      action: "updateProfile" as const,
      ts: now(),
      nonce: bytesToBase64(deps.randomBytes(16)),
      payload,
    };
    const req: SignedRequest = { ...fields, signature: bytesToBase64(deps.signRequest(fields, own.signSk)) };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    let res: ServerResult | "timeout";
    try {
      res = await Promise.race([deps.updateProfileFn(req), timeout]);
    } catch {
      return { ok: false, code: "network_error" };
    } finally {
      clearTimeout(timer);
    }
    if (res === "timeout") return { ok: false, code: "timeout" };
    if (!res.ok) return res.field === undefined ? { ok: false, code: res.code } : { ok: false, code: res.code, field: res.field };

    try {
      const latest = (await deps.repos.pinRepo.get(ownPin)) ?? own;
      const saved: PinRecord = {
        ...latest,
        presence: res.value.status,
        personalMessage: res.value.personalMessage,
      };
      await deps.repos.pinRepo.put(saved);
      deps.onSaved?.(saved);
    } catch {
      return { ok: false, code: "network_error" };
    }
    return { ok: true, status: res.value.status, personalMessage: res.value.personalMessage };
  };
}
