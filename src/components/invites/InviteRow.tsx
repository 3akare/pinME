import { useState } from "react";
import type { InviteRecord } from "../../client/storage";
import type { FlowResult } from "../../client/invites/flow";
import { inviteErrorMessage } from "../../client/invites/messages";

export interface InviteRowProps {
  invite: InviteRecord;
  /** Label of the own PIN the invite was sent to, shown when the user has several PINs. */
  pinLabel?: string;
  /** Resolves with the flow result; on success the parent removes the invite. */
  onRespond: (invite: InviteRecord, accept: boolean) => Promise<FlowResult>;
}

export function InviteRow({ invite, pinLabel, onRespond }: InviteRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
    <li className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-text">
            Invite from <span className="font-mono">{invite.fromPin}</span>
          </span>
          {invite.fromDisplayName || pinLabel ? (
            <span className="truncate text-sm text-muted">
              {invite.fromDisplayName ? <strong className="font-semibold text-text">{invite.fromDisplayName}</strong> : null}
              {invite.fromDisplayName && pinLabel ? " · " : null}
              {pinLabel ? `to your ${pinLabel} PIN` : null}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void respond(true)}
          className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void respond(false)}
          className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Decline
        </button>
      </div>
      <p role="alert" aria-live="assertive" className="min-h-5 pt-1 text-sm text-red-300">
        {error}
      </p>
    </li>
  );
}
