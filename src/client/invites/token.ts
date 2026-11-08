import { newInviteToken } from "../../shared/scan";
import type { PinRecord, Repositories } from "../storage";

export interface InviteTokenDeps {
  repos: Pick<Repositories, "pinRepo">;
  randomBytes: (n: number) => Uint8Array;
  /** Mirrors a saved PIN record into the pins store. */
  onSaved: (pin: PinRecord) => void;
}

/** Gives every active PIN created before invite links existed a link token. */
export async function ensureInviteTokens(deps: InviteTokenDeps, pins: readonly PinRecord[]): Promise<void> {
  for (const p of pins) {
    if (p.status !== "active" || p.inviteToken) continue;
    const saved = { ...p, inviteToken: newInviteToken(deps.randomBytes) };
    await deps.repos.pinRepo.put(saved);
    deps.onSaved(saved);
  }
}

/** Replaces a PIN's link token, so QR codes and links shared until now stop auto-connecting. */
export async function resetInviteToken(deps: InviteTokenDeps, pin: string): Promise<PinRecord | null> {
  const current = await deps.repos.pinRepo.get(pin);
  if (!current || current.status !== "active") return null;
  const saved = { ...current, inviteToken: newInviteToken(deps.randomBytes) };
  await deps.repos.pinRepo.put(saved);
  deps.onSaved(saved);
  return saved;
}
