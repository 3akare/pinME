import { Icon } from "../ui/Icon";

/** "N unread messages": where the reader left off when the chat was opened. Stays put while it is open. */
export function UnreadDivider({ count }: { count: number }) {
  return (
    <div data-unread-divider role="separator" aria-label={`${count} unread`} className="my-3 flex items-center gap-3 text-xs text-accent">
      <span className="h-px flex-1 bg-accent/40" />
      <span className="font-semibold">{count === 1 ? "1 unread message" : `${count} unread messages`}</span>
      <span className="h-px flex-1 bg-accent/40" />
    </div>
  );
}

/** Floating button back to the newest message, with how many arrived while the reader looked back. */
export function JumpToLatest({ unseen, onJump }: { unseen: number; onJump: () => void }) {
  const label = unseen > 0 ? (unseen === 1 ? "1 new message" : `${unseen} new messages`) : "Jump to latest";
  return (
    <button
      type="button"
      onClick={onJump}
      // Keep the composer focused (and the keyboard up) when this is tapped.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      aria-label={label}
      className="jump-latest absolute bottom-3 right-3 z-10 flex h-11 items-center gap-2 rounded-pill bg-paper-3 px-3 text-sm text-ink shadow-card sm:right-6"
    >
      {unseen > 0 ? (
        <span aria-hidden className="min-w-5 rounded-pill bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-ink">
          {unseen > 99 ? "99+" : unseen}
        </span>
      ) : null}
      <Icon name="down" className="h-5 w-5" />
    </button>
  );
}

/** Announces arrivals to screen readers without reading out the whole history on open. */
export function ArrivalAnnouncer({ text }: { text: string }) {
  return (
    <p className="visually-hidden" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}
