import type { InviteFlow } from "../../invites/flow";
import type { Dispatcher, Handler } from "../dispatch";

/**
 * inviteNotice handler for one own PIN. Handles kinds `invite` and `accepted`;
 * `presence` is handled by the presence handler (task 11.4).
 */
export function createInviteNoticeHandler(
  ownPin: string,
  flow: InviteFlow,
  onError: () => void = () => {},
  /** The Dispatcher keeps one handler per type, so presence is delegated (task 11.4). */
  onPresence: Handler<"inviteNotice"> = () => {},
): Handler<"inviteNotice"> {
  return (msg) => {
    let work: Promise<unknown> | null = null;
    if (msg.kind === "presence") onPresence(msg);
    else if (msg.kind === "invite") {
      if (msg.inviteId) work = flow.onInvite(ownPin, msg.from, msg.inviteId);
    } else if (msg.kind === "accepted") {
      work = flow.onAccepted(ownPin, msg.from);
    }
    work?.catch(onError);
  };
}

export function registerInviteHandlers(
  dispatcher: Dispatcher,
  ownPin: string,
  flow: InviteFlow,
  onPresence?: Handler<"inviteNotice">,
): () => void {
  return dispatcher.register("inviteNotice", createInviteNoticeHandler(ownPin, flow, undefined, onPresence));
}
