import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import { Icon } from "../ui/Icon";

export interface MessageInputProps {
  /** Resolves true when the message was accepted (sent or queued); the field is then cleared. */
  onSend: (text: string) => Promise<boolean> | boolean;
  /** Offline sends are queued, so this only changes the hint. */
  connected: boolean;
  disabled?: boolean;
  /** Hook for the typing indicator; receives the current text on every change. */
  onChange?: (text: string) => void;
  /** Slot for the PingButton. */
  pingSlot?: ReactNode;
}

/** Composer pinned to the bottom of the chat: Enter sends, Shift+Enter starts a new line. */
export function MessageInput({ onSend, connected, disabled, onChange, pingSlot }: MessageInputProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const valid = text.trim().length >= 1 && text.length <= MAX_PLAINTEXT_CHARS;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (disabled || busy || !valid) return;
    setBusy(true);
    setError(undefined);
    try {
      const ok = await onSend(text);
      if (ok) {
        setText("");
        onChange?.("");
        boxRef.current?.focus();
      } else {
        setError("Message could not be sent.");
      }
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  const hint = error ?? (!connected ? "Offline. Messages send as soon as you reconnect." : text.length > MAX_PLAINTEXT_CHARS - 200 ? `${text.length}/${MAX_PLAINTEXT_CHARS}` : "");

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 border-t border-rule bg-paper px-3 pb-3 pt-2 sm:px-4">
      <label htmlFor="message-text" className="visually-hidden">
        Message
      </label>
      <div className="flex items-end gap-2">
        {pingSlot}
        <textarea
          id="message-text"
          ref={boxRef}
          rows={1}
          value={text}
          maxLength={MAX_PLAINTEXT_CHARS}
          disabled={disabled}
          placeholder="Message"
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setText(e.target.value);
            onChange?.(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          aria-describedby="message-hint"
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border-0 bg-paper-2 px-4 py-2.5 text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-55"
        />
        <button type="submit" disabled={disabled || busy || !valid} aria-label="Send" className="btn btn--primary h-11 w-11 shrink-0 px-0">
          <Icon name="send" />
        </button>
      </div>
      <p id="message-hint" role="status" aria-live="polite" className={`min-h-4 px-2 text-xs ${error ? "text-error" : "text-muted"}`}>
        {hint}
      </p>
    </form>
  );
}
