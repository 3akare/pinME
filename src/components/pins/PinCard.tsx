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

  const btn =
    "rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <article
      aria-label={`PIN ${label}`}
      className={`rounded-2xl border bg-surface p-4 ${selected ? "border-accent" : "border-border"}`}
    >
      {editing ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <label htmlFor={`rename-${pin}`} className="text-sm font-medium">
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
            className="rounded-xl border border-border bg-transparent px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-accent"
          />
          <p id={`rename-${pin}-error`} role="alert" className="min-h-5 text-sm text-red-300">
            {error}
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${btn} bg-accent text-on-accent`}>
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
          <h3 className="truncate text-lg font-semibold">{label}</h3>
          <p className="font-mono text-muted">{pin}</p>
          <p className="text-sm text-muted">
            {contactCount} {contactCount === 1 ? "contact" : "contacts"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
