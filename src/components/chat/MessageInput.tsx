import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import { Icon } from "../ui/Icon";
import { dialogOpen } from "./useConversationScroll";

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
  /** Keeps an unsent draft for this conversation while the tab lives. */
  draftKey?: string;
}

const MAX_HEIGHT_PX = 160;
const DRAFT_PREFIX = "pinme:draft:";

/** Touch-first device: the on-screen keyboard's Enter adds a line, the button sends. */
function subscribeCoarse(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const coarseNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
const useCoarsePointer = () => useSyncExternalStore(subscribeCoarse, coarseNow, () => false);

const fieldSizingSupported = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

// Drafts stay in this tab's session storage only: plaintext should not outlive the tab on disk.
function readDraft(key?: string): string {
  if (!key) return "";
  try {
    return sessionStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key: string | undefined, text: string): void {
  if (!key) return;
  try {
    if (text) sessionStorage.setItem(DRAFT_PREFIX + key, text);
    else sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // storage blocked: the draft lives only while the chat is open
  }
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

/** Composer pinned to the bottom of the chat. Enter sends on a keyboard (Shift+Enter: new line); on touch the button sends. */
export function MessageInput({ onSend, connected, disabled, onChange, pingSlot, draftKey }: MessageInputProps) {
  const [text, setText] = useState(() => readDraft(draftKey));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const coarse = useCoarsePointer();
  const valid = text.trim().length >= 1 && text.length <= MAX_PLAINTEXT_CHARS;

  // Grow with the text, and shrink back once it is sent. CSS does it where field-sizing is supported.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || fieldSizingSupported()) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  // Save the draft shortly after typing stops, and when leaving the chat.
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => {
    const h = setTimeout(() => writeDraft(draftKey, text), 400);
    return () => clearTimeout(h);
  }, [draftKey, text]);
  useEffect(() => {
    const save = () => writeDraft(draftKey, latest.current);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [draftKey]);

  // On a desktop, typing anywhere in the chat goes into the composer.
  useEffect(() => {
    if (coarse) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const box = boxRef.current;
      if (!box || box.disabled || e.defaultPrevented || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (isEditable(e.target) || dialogOpen()) return;
      box.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [coarse]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (disabled || busy || !valid) return;
    const sending = text;
    setBusy(true);
    setError(undefined);
    // Clear at once: the message shows in the conversation while it is encrypted and sent.
    setText("");
    writeDraft(draftKey, "");
    onChange?.("");
    try {
      const ok = await onSend(sending);
      if (!ok) {
        setText((now) => (now ? now : sending));
        setError("Message could not be sent.");
      }
    } catch {
      setText((now) => (now ? now : sending));
      setError("Message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (coarse) return; // on-screen keyboards: Enter is a new line
    e.preventDefault();
    void submit();
  }

  const hint = error ?? (!connected ? "Offline. Messages send as soon as you reconnect." : text.length > MAX_PLAINTEXT_CHARS - 200 ? `${text.length}/${MAX_PLAINTEXT_CHARS}` : "");

  return (
    <form onSubmit={submit} className="composer-pad flex shrink-0 flex-col gap-1 border-t border-rule bg-paper px-3 pt-2 sm:px-4">
      <label htmlFor="message-text" className="visually-hidden">
        Message
      </label>
      <div
        className="flex items-end gap-2"
        // Tapping a button here must not take focus from the text box: that would drop the keyboard.
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button") && document.activeElement === boxRef.current) e.preventDefault();
        }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button") && document.activeElement === boxRef.current) e.preventDefault();
        }}
      >
        {pingSlot}
        <textarea
          id="message-text"
          ref={boxRef}
          rows={1}
          value={text}
          maxLength={MAX_PLAINTEXT_CHARS}
          disabled={disabled}
          placeholder="Message"
          enterKeyHint={coarse ? "enter" : "send"}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(undefined);
            onChange?.(e.target.value);
          }}
          aria-describedby="message-hint"
          className="composer-field max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border-0 bg-paper-2 px-4 py-2.5 text-base text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-55"
        />
        <button type="submit" disabled={disabled || busy || !valid} aria-label="Send" className="btn btn--primary h-11 w-11 shrink-0 px-0">
          <Icon name="send" />
        </button>
      </div>
      <p id="message-hint" role="status" aria-live="polite" className={hint ? `px-2 text-xs ${error ? "text-error" : "text-muted"}` : "visually-hidden"}>
        {hint}
      </p>
    </form>
  );
}
