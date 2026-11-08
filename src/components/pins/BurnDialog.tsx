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
      <h2 id="burn-title" className="font-display text-2xl">
        Burn {label}?
      </h2>
      <p id="burn-desc" className="mt-3 text-ink-2">
        PIN <span className="[font-variant-numeric:lining-nums_tabular-nums] text-ink">{pin}</span> will be burned permanently. This cannot be undone. Everyone who
        only knew this PIN is cut off for good.
      </p>
      <p role="alert" aria-live="assertive" className="mt-2 min-h-5 text-sm text-error">
        {error}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn btn--quiet btn--sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="btn btn--primary btn--sm"
        >
          {busy ? "Burning..." : "Burn PIN"}
        </button>
      </div>
    </Modal>
  );
}
