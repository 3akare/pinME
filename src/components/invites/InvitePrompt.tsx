import { useRef, useState } from "react";
import { inviteErrorMessage } from "../../client/invites/messages";
import { useContactsStore } from "../../client/state/contacts";
import { usePinsStore } from "../../client/state/pins";
import type { InviteRecord } from "../../client/storage";
import { Modal } from "../ui/Modal";
import { useInviteResponder } from "./useInviteResponder";

/**
 * Asks about each incoming invite on whatever screen the user is on, for any of their PINs.
 * "Later" hides an invite for this visit; it stays in the Pending invites list on Contacts.
 */
export function InvitePrompt() {
  const invites = useContactsStore((s) => s.pendingInvites);
  const pins = usePinsStore((s) => s.pins);
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());
  const next = invites
    .filter((i) => !deferred.has(i.inviteId))
    .reduce<InviteRecord | null>((a, b) => (a && a.createdAt <= b.createdAt ? a : b), null);
  if (!next) return null;
  const pin = pins.find((p) => p.pin === next.ownPin);
  return (
    <InviteDialog
      key={next.inviteId}
      invite={next}
      pinLabel={pins.length > 1 ? pin?.label : undefined}
      onLater={() => setDeferred((d) => new Set(d).add(next.inviteId))}
    />
  );
}

function InviteDialog({ invite, pinLabel, onLater }: { invite: InviteRecord; pinLabel?: string; onLater: () => void }) {
  const respond = useInviteResponder();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const who = invite.fromDisplayName ?? "Someone";

  async function answer(accept: boolean) {
    if (busy) return;
    setBusy(accept ? "accept" : "decline");
    setError(undefined);
    try {
      const res = await respond(invite, accept);
      // On success the invite leaves the store and this dialog unmounts.
      if (!res.ok) setError(inviteErrorMessage(res.code));
    } catch {
      setError(inviteErrorMessage("unknown"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal labelledBy="invite-prompt-title" describedBy="invite-prompt-desc" initialFocus={acceptRef} onDismiss={busy ? undefined : onLater}>
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">New contact request</p>
      <h2 id="invite-prompt-title" className="mt-1 text-lg font-semibold text-text">
        {who} wants to chat
      </h2>
      <p id="invite-prompt-desc" className="mt-2 text-sm text-muted">
        PIN <span className="font-mono text-text">{invite.fromPin}</span> sent an invite
        {pinLabel ? (
          <>
            {" "}to your <strong className="text-text">{pinLabel}</strong> PIN
          </>
        ) : null}
        . Accept to add them and open the chat. They only see this PIN, never your other PINs.
      </p>
      <p role="alert" aria-live="assertive" className="mt-2 min-h-5 text-sm text-red-300">
        {error}
      </p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onLater}
          disabled={!!busy}
          className="mr-auto rounded-xl px-3 py-2 text-sm text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => void answer(false)}
          disabled={!!busy}
          className="rounded-xl border border-border px-4 py-2 font-semibold text-text hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {busy === "decline" ? "Declining..." : "Decline"}
        </button>
        <button
          ref={acceptRef}
          type="button"
          onClick={() => void answer(true)}
          disabled={!!busy}
          className="rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {busy === "accept" ? "Accepting..." : "Accept"}
        </button>
      </div>
    </Modal>
  );
}
