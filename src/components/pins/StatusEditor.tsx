import { useState } from "react";
import type { Presence, UpdateResult } from "../../client/profile/update";
import { PERSONAL_MESSAGE_MAX } from "../../shared/limits";
import { isValidPersonalMessage } from "../../shared/validation";

export interface StatusValues {
  status: Presence;
  personalMessage: string;
}

export interface StatusEditorProps {
  /** Last saved values. */
  initial: StatusValues;
  /** Sends the change; resolves with the result of the signed update. */
  onSave: (change: StatusValues) => Promise<UpdateResult>;
}

/** Validation message for a draft personal message, or null when valid (Req 11.2). */
export function personalMessageError(value: string): string | null {
  return isValidPersonalMessage(value)
    ? null
    : `Personal message must be at most ${PERSONAL_MESSAGE_MAX} characters.`;
}

export function saveErrorMessage(code: string): string {
  switch (code) {
    case "timeout":
      return "Saving timed out. Your previous status is unchanged.";
    case "validation_failed":
      return "That status or message is not valid. Your previous status is unchanged.";
    default:
      return "Could not save your status. Your previous status is unchanged.";
  }
}

export function StatusEditor({ initial, onSave }: StatusEditorProps) {
  const [saved, setSaved] = useState<StatusValues>(initial);
  const [status, setStatus] = useState<Presence>(initial.status);
  const [message, setMessage] = useState(initial.personalMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const validation = personalMessageError(message);

  async function save() {
    if (busy || validation) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await onSave({ status, personalMessage: message });
      if (res.ok) {
        const next = { status: res.status, personalMessage: res.personalMessage };
        setSaved(next);
        setStatus(next.status);
        setMessage(next.personalMessage);
      } else {
        // Keep the last saved values (Req 11.10).
        setStatus(saved.status);
        setMessage(saved.personalMessage);
        setError(saveErrorMessage(res.code));
      }
    } catch {
      setStatus(saved.status);
      setMessage(saved.personalMessage);
      setError(saveErrorMessage("network_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="flex gap-4">
        <legend className="mb-2 text-sm font-medium text-ink-2">Status</legend>
        {(["available", "busy"] as const).map((s) => (
          <label key={s} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="status"
              value={s}
              checked={status === s}
              onChange={() => setStatus(s)}
              className="h-4 w-4 accent-accent focus-visible:outline-2 focus-visible:outline-focus"
            />
            {s === "available" ? "Available" : "Busy"}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink-2">Personal message</span>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={validation ? true : undefined}
          aria-describedby="status-editor-feedback"
          className="field"
        />
        <span className="text-xs text-muted">
          {message.length}/{PERSONAL_MESSAGE_MAX}
        </span>
      </label>
      <div id="status-editor-feedback" role="alert" className="text-sm text-error">
        {validation ? <p>{validation}</p> : null}
        {error ? <p>{error}</p> : null}
      </div>
      <button
        type="submit"
        disabled={busy || validation !== null}
        className="btn btn--quiet btn--sm self-start"
      >
        {busy ? "Saving…" : "Save status"}
      </button>
    </form>
  );
}
