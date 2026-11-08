import { useState, type FormEvent } from "react";
import { PIN_LABEL_MAX } from "../../shared/limits";

export interface PinCardProps {
  pin: string;
  label: string;
  contactCount: number;
  selected?: boolean;
  onOpen: (pin: string) => void;
  /** Resolves with an error message, or undefined on success. */
  onRename: (pin: string, label: string) => Promise<string | undefined>;
}

/** One Active_PIN: label, PIN, contact count, with open and rename actions. */
export function PinCard({ pin, label, contactCount, selected, onOpen, onRename }: PinCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const err = await onRename(pin, draft);
    setBusy(false);
    setError(err);
    if (!err) setEditing(false);
  }

  const btn = "btn btn--quiet btn--sm";

  return (
    <article
      aria-label={`PIN ${label}`}
      className={`flex flex-col gap-3 border-b border-rule px-3 py-4 transition-colors duration-[var(--dur-micro)] ${selected ? "bg-paper-2" : ""}`}
    >
      {editing ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <label htmlFor={`rename-${pin}`} className="text-sm font-medium text-ink-2">
            PIN label
          </label>
          <input
            id={`rename-${pin}`}
            type="text"
            value={draft}
            maxLength={PIN_LABEL_MAX * 2}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`rename-${pin}-error`}
            className="field"
          />
          <p id={`rename-${pin}-error`} role="alert" className="min-h-5 text-sm text-error">
            {error}
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn btn--primary btn--sm">
              Save label
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setEditing(false);
                setDraft(label);
                setError(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate font-display text-2xl">{label}</h3>
            <p data-testid="pin-value" className="shrink-0 font-display text-xl [font-variant-numeric:lining-nums_tabular-nums] text-ink-2">
              {pin}
            </p>
          </div>
          <p className="text-sm text-muted">
            {contactCount} {contactCount === 1 ? "contact" : "contacts"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => onOpen(pin)} aria-pressed={selected}>
              Details
              <span className="sr-only"> for {label}</span>
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setDraft(label);
                setEditing(true);
              }}
            >
              Rename<span className="sr-only"> {label}</span>
            </button>
          </div>
        </>
      )}
    </article>
  );
}
