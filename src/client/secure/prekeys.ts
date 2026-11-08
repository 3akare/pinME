import { generateDh, signPrekey } from "../crypto/ratchet";
import { bytesToBase64 } from "../../shared/base64";
import type { PinRecord, PrekeyRecord, Repositories } from "../storage";

/** A new signed prekey after this long; the previous one stays usable for late first messages. */
export const SPK_ROTATE_MS = 7 * 86_400_000;
/** Signed prekeys older than this are deleted. */
export const SPK_RETIRE_MS = 30 * 86_400_000;
/** Top up one-time prekeys below this many on the server. */
export const OPK_LOW = 10;
export const OPK_BATCH = 20;

export interface PrekeyUpkeepDeps {
  repos: Pick<Repositories, "prekeyRepo">;
  /** Signed `publishPrekeys`; resolves with how many one-time prekeys the server holds. */
  publish: (
    pin: PinRecord,
    payload: { spk?: { id: number; pub: string; sig: string }; opks: { id: number; pub: string }[] },
  ) => Promise<{ ok: true; value: { opkCount: number } } | { ok: false; code: string }>;
  randomId: () => number;
  now?: () => number;
}

/**
 * Keeps one PIN's prekeys healthy: rotates the signed prekey weekly, retires old ones, and tops up
 * one-time prekeys. Private halves never leave the device; only public keys are published.
 */
export async function ensurePrekeys(deps: PrekeyUpkeepDeps, pin: PinRecord): Promise<boolean> {
  const now = (deps.now ?? Date.now)();
  const local = await deps.repos.prekeyRepo.listForPin(pin.pin);
  const spks = local.filter((k) => k.kind === "spk").sort((a, b) => b.createdAt - a.createdAt);
  for (const old of spks.slice(1)) {
    if (now - old.createdAt > SPK_RETIRE_MS) await deps.repos.prekeyRepo.delete(pin.pin, old.id);
  }

  const fresh = async (kind: PrekeyRecord["kind"]): Promise<PrekeyRecord> => {
    const kp = generateDh();
    const rec: PrekeyRecord = { ownPin: pin.pin, id: deps.randomId(), kind, pub: kp.pub, priv: kp.priv, createdAt: now };
    await deps.repos.prekeyRepo.put(rec);
    return rec;
  };

  let spk: { id: number; pub: string; sig: string } | undefined;
  if (!spks[0] || now - spks[0].createdAt > SPK_ROTATE_MS) {
    const rec = await fresh("spk");
    spk = { id: rec.id, pub: bytesToBase64(rec.pub), sig: bytesToBase64(signPrekey(rec.pub, pin.signSk)) };
  }
  const first = await deps.publish(pin, spk ? { spk, opks: [] } : { opks: [] });
  if (!first.ok) return false;
  if (first.value.opkCount >= OPK_LOW) return true;
  const opks = [];
  for (let i = 0; i < OPK_BATCH; i++) {
    const rec = await fresh("opk");
    opks.push({ id: rec.id, pub: bytesToBase64(rec.pub) });
  }
  return (await deps.publish(pin, { opks })).ok;
}
