import { useRef } from "react";
import { Modal } from "../ui/Modal";
export interface BurnDialogProps {
  label: string;
  pin: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
/** Accessible modal confirming a permanent burn (Req 13.1). */
export function BurnDialog({ label, pin, busy, error, onConfirm, onCancel }: BurnDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal labelledBy="burn-title" describedBy="burn-desc" initialFocus={cancelRef} onDismiss={busy ? undefined : onCancel}>
      <h2 id="burn-title" className="text-lg font-semibold">
        Burn {label}?
      </h2>
      <p id="burn-desc" className="mt-2 text-sm">
        PIN <span className="font-mono">{pin}</span> will be burned permanently. This cannot be undone. Everyone who
        only knew this PIN is cut off for good.
      </p>
      <p role="alert" aria-live="assertive" className="mt-2 min-h-5 text-sm text-red-300">
        {error}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl border border-border px-4 py-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-xl bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {busy ? "Burning..." : "Burn PIN"}
        </button>
      </div>
    </Modal>
  );
}
