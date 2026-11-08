import { useState, type FormEvent, type ReactNode } from "react";
import { MAX_PLAINTEXT_CHARS } from "../../shared/limits";

export interface MessageInputProps {
  /** Resolves true when the message was sent (the field is then cleared). */
  onSend: (text: string) => Promise<boolean> | boolean;
  /** Send is disabled while disconnected. */
  connected: boolean;
  disabled?: boolean;
  /** Hook for the typing indicator (task 9.3); receives the current text on every change. */
  onChange?: (text: string) => void;
  /** Slot for the PingButton (task 10.2). */
  pingSlot?: ReactNode;
}

export function MessageInput({ onSend, connected, disabled, onChange, pingSlot }: MessageInputProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const blocked = !connected || !!disabled;
  const valid = text.length >= 1 && text.length <= MAX_PLAINTEXT_CHARS;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocked || busy || !valid) return;
    setBusy(true);
    setError(undefined);
    try {
      const ok = await onSend(text);
      if (ok) {
        setText("");
        onChange?.("");
      } else {
        setError("Message could not be sent.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 border-t border-border pt-3">
      <label htmlFor="message-text" className="sr-only">
        Message
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="message-text"
          rows={1}
          value={text}
          maxLength={MAX_PLAINTEXT_CHARS}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            onChange?.(e.target.value);
          }}
          aria-describedby="message-hint"
          className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-accent"
        />
        {pingSlot}
        <button
          type="submit"
          disabled={blocked || busy || !valid}
          className="rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <p id="message-hint" role="status" aria-live="polite" className="text-xs text-muted">
        {!connected ? "Disconnected. Sending is disabled until you reconnect." : `${text.length}/${MAX_PLAINTEXT_CHARS}`}
        {error ? ` ${error}` : ""}
      </p>
    </form>
  );
}
