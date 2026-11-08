import { bytesToBase64 } from "../../shared/base64";
import type { PinRecord } from "../storage";
export const BURN_TIMEOUT_MS = 10_000;
export const BURN_FAILED_MESSAGE = "The burn did not complete. Your PIN and chats are unchanged.";
export type BurnRequest = {
  pin: string;
  action: "burn";
  ts: number;
  nonce: string;
  payload: Record<string, never>;
  signature: string;
};
export interface BurnFlowDeps {
  /** Crypto_Module signRequest. */
  signRequest: (
    fields: { pin: string; action: "burn"; ts: number; nonce: string; payload: unknown },
    signSk: Uint8Array,
  ) => Uint8Array;
  randomBytes: (n: number) => Uint8Array;
  /** Calls the burn server function. */
  burnPinFn: (req: BurnRequest) => Promise<{ ok: boolean }>;
  /** Resolves when the Ghost_Animation has finished. */
  playAnimation: () => Promise<void>;
  /** Single-transaction Local_Store removal scoped to this PIN. */
  cleanup: (pin: string) => Promise<void>;
  /** Closes the PIN's session via the connection manager. */
  closeSession: (pin: string) => void;
  /** Removes the PIN's data from the pins/contacts/chat stores. */
  updateStores: (pin: string) => void;
  now?: () => number;
  timeoutMs?: number;
}
export type BurnOutcome = { ok: true } | { ok: false; message: string };
const TIMEOUT = Symbol("timeout");
/**
 * Burns one PIN. On error or timeout nothing local changes and no animation plays
 * (Req 13.13). On success the animation plays first, and only after it completes
 * is local data removed (Req 13.7, 13.8).
 */
export async function burnPinFlow(deps: BurnFlowDeps, own: Pick<PinRecord, "pin" | "signSk">): Promise<BurnOutcome> {
  const fields = {
    pin: own.pin,
    action: "burn" as const,
    ts: (deps.now ?? Date.now)(),
    nonce: bytesToBase64(deps.randomBytes(16)),
    payload: {} as Record<string, never>,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let res: { ok: boolean } | typeof TIMEOUT;
  try {
    const req: BurnRequest = { ...fields, signature: bytesToBase64(deps.signRequest(fields, own.signSk)) };
    res = await Promise.race([
      deps.burnPinFn(req),
      new Promise<typeof TIMEOUT>((r) => {
        timer = setTimeout(() => r(TIMEOUT), deps.timeoutMs ?? BURN_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return { ok: false, message: BURN_FAILED_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
  if (res === TIMEOUT || !res || res.ok !== true) return { ok: false, message: BURN_FAILED_MESSAGE };
  try {
    await deps.playAnimation();
  } catch {
    // Animation is cosmetic; cleanup still runs.
  }
  try {
    await deps.cleanup(own.pin);
  } catch {
    return { ok: false, message: "The PIN was burned but local data could not be removed. Reload and try again." };
  }
  deps.closeSession(own.pin);
  deps.updateStores(own.pin);
  return { ok: true };
}
