export interface TypingIndicatorProps {
  /** Contact display name. */
  name: string;
  visible: boolean;
}

/** "Name is writing a message..." shown while a Contact is typing (Req 10.3). */
export function TypingIndicator({ name, visible }: TypingIndicatorProps) {
  return (
    <p role="status" aria-live="polite" className="min-h-5 px-1 text-xs italic text-muted">
      {visible ? `${name} is writing a message...` : ""}
    </p>
  );
}
