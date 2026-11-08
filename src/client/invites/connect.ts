import type { InviteTarget } from "../../shared/scan";
import type { Repositories } from "../storage";
import type { InviteFlow } from "./flow";

export type ConnectOutcome =
  /** Already a Contact: open the chat. */
  | { kind: "chat" }
  /** They had already invited us; we accepted, so the chat is ready. */
  | { kind: "accepted" }
  /** Our invite is with them (sent now or earlier). With a link token they accept automatically. */
  | { kind: "waiting" }
  | { kind: "own" }
  | { kind: "error"; code: string; retryAfterSec?: number };

export interface ConnectDeps {
  flow: Pick<InviteFlow, "sendInvite" | "respondInvite">;
  repos: Pick<Repositories, "contactRepo" | "inviteRepo">;
  ownPins: readonly string[];
}

/**
 * One step from "I have their PIN or link" to a conversation, whatever state the pair is in.
 * Every entry point (camera link, in-app scan, typed PIN) goes through here.
 */
export async function connectTo(deps: ConnectDeps, ownPin: string, target: InviteTarget): Promise<ConnectOutcome> {
  if (deps.ownPins.includes(target.pin)) return { kind: "own" };

  const contact = await deps.repos.contactRepo.get(ownPin, target.pin);
  if (contact && !contact.unavailable) return { kind: "chat" };

  const theirs = (await deps.repos.inviteRepo.listForPin(ownPin)).find((i) => i.fromPin === target.pin);
  if (theirs) {
    const res = await deps.flow.respondInvite(ownPin, theirs.inviteId, true);
    return res.ok ? { kind: "accepted" } : { kind: "error", code: res.code };
  }

  const res = await deps.flow.sendInvite(ownPin, target.pin, target.token);
  if (res.ok) return { kind: "waiting" };
  // A pending invite from us already exists: keep waiting for it.
  if (res.code === "duplicate") return { kind: "waiting" };
  return res.retryAfterSec === undefined
    ? { kind: "error", code: res.code }
    : { kind: "error", code: res.code, retryAfterSec: res.retryAfterSec };
}
