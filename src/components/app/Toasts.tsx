import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { inviteErrorMessage } from "../../client/invites/messages";
import { usePinsStore } from "../../client/state/pins";
import { useToastStore, type Toast } from "../../client/state/toasts";
import { useInviteResponder } from "../invites/useInviteResponder";
import { Icon } from "../ui/Icon";

const TOAST_MS = 8000;

/** Non-blocking notifications at the bottom of the screen; requests stay until answered. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-3 sm:items-end sm:p-5">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const navigate = useNavigate();
  const dismiss = useToastStore((s) => s.dismiss);
  const respond = useInviteResponder();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (toast.invite) return;
    const h = setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(h);
  }, [toast.id, toast.invite, dismiss]);

  function openChat() {
    if (!toast.chat) return;
    usePinsStore.getState().setActivePin(toast.chat.ownPin);
    void navigate({ to: "/chat/$pin", params: { pin: toast.chat.contactPin } });
    dismiss(toast.id);
  }

  async function answer(accept: boolean) {
    if (!toast.invite || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await respond(toast.invite, accept);
      if (res.ok) dismiss(toast.id);
      else setError(inviteErrorMessage(res.code));
    } catch {
      setError(inviteErrorMessage("unknown"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-full max-w-sm flex-col gap-2 rounded-card bg-paper-3 px-4 py-3 shadow-card"
    >
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-ink">{toast.text}</p>
        {toast.chat ? (
          <button type="button" onClick={openChat} className="btn btn--primary btn--sm">
            Open chat
          </button>
        ) : null}
        {toast.invite ? (
          <>
            <button type="button" disabled={busy} onClick={() => void answer(false)} className="btn btn--quiet btn--sm">
              Decline
            </button>
            <button type="button" disabled={busy} onClick={() => void answer(true)} className="btn btn--primary btn--sm">
              Accept
            </button>
          </>
        ) : (
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" className="icon-btn h-8 w-8">
            <Icon name="close" className="h-4 w-4" />
          </button>
        )}
      </div>
      {error ? <p className="text-sm text-error">{error}</p> : null}
    </div>
  );
}
