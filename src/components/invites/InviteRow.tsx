import { useState } from "react";
import type { InviteRecord } from "../../client/storage";
import type { FlowResult } from "../../client/invites/flow";
import { inviteErrorMessage } from "../../client/invites/messages";
import { Avatar } from "../ui/Avatar";

export interface InviteRowProps {
  invite: InviteRecord;
  /** Label of the own PIN the request was sent to, shown when the user has several PINs. */
  pinLabel?: string;
  /** Resolves with the flow result; on success the parent removes the request. */
  onRespond: (invite: InviteRecord, accept: boolean) => Promise<FlowResult>;
}

/** A chat request from someone who typed this PIN by hand: one tap to accept. */
export function InviteRow({ invite, pinLabel, onRespond }: InviteRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const name = invite.fromDisplayName ?? invite.fromPin;

  async function respond(accept: boolean) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await onRespond(invite, accept);
      if (!res.ok) setError(inviteErrorMessage(res.code));
    } catch {
      setError(inviteErrorMessage("unknown"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-2xl bg-elevated px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Avatar name={name} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-text">{name}</span>
          <span className="truncate text-xs text-muted">
            Invite from <span className="font-mono">{invite.fromPin}</span>
            {pinLabel ? ` · to ${pinLabel}` : null}
          </span>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void respond(false)}
          className="rounded-full px-3 py-1.5 text-sm font-medium text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Decline
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void respond(true)}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Accept
        </button>
      </div>
      <p role="alert" aria-live="assertive" className="text-sm text-red-300 empty:hidden">
        {error}
      </p>
    </li>
  );
}
