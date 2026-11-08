import type { ServerMsg } from "../../../shared/protocol";
import type { ContactRecord, Repositories } from "../../storage";
import type { Handler } from "../dispatch";

export interface PresenceHandlerDeps {
  repos: Pick<Repositories, "contactRepo">;
  /** Mirrors the updated contact into the contacts store. */
  store: { upsertContact(c: ContactRecord): void };
}

type InviteNotice = Extract<ServerMsg, { type: "inviteNotice" }>;

/**
 * Handles inviteNotice kind "presence" for one own PIN: updates the matching
 * Contact's presence and personalMessage in Local_Store and the contacts store.
 * Notices from non-contacts are ignored (Req 11.8).
 */
export function createPresenceHandler(ownPin: string, deps: PresenceHandlerDeps): Handler<"inviteNotice"> {
  return (msg: InviteNotice) => {
    if (msg.kind !== "presence") return;
    void apply(msg).catch(() => {});
  };

  async function apply(msg: InviteNotice): Promise<void> {
    const existing = await deps.repos.contactRepo.get(ownPin, msg.from);
    if (!existing) return;
    const updated: ContactRecord = { ...existing };
    if (msg.status !== undefined) updated.presence = msg.status;
    if (msg.personalMessage !== undefined) updated.personalMessage = msg.personalMessage;
    await deps.repos.contactRepo.put(updated);
    deps.store.upsertContact(updated);
  }
}
