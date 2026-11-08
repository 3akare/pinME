import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePinsStore } from "../../client/state/pins";
import { useToastStore, type Toast } from "../../client/state/toasts";

const TOAST_MS = 8000;

/** Non-blocking notifications pinned to the bottom of the screen. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const navigate = useNavigate();
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const h = setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(h);
  }, [toast.id, dismiss]);

  function openChat() {
    if (!toast.chat) return;
    usePinsStore.getState().setActivePin(toast.chat.ownPin);
    void navigate({ to: "/chat/$pin", params: { pin: toast.chat.contactPin } });
    dismiss(toast.id);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-accent/60 bg-surface px-4 py-3 shadow-lg"
    >
      <p className="min-w-0 flex-1 text-sm text-text">{toast.text}</p>
      {toast.chat ? (
        <button
          type="button"
          onClick={openChat}
          className="rounded-xl bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Open chat
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="rounded-lg px-2 py-1 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        ×
      </button>
    </div>
  );
}
