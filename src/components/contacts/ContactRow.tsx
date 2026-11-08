import { formatListTime } from "../../client/chat/format";
import type { ContactRecord, MessageRecord } from "../../client/storage";
import { Avatar } from "../ui/Avatar";

export type DotState = "available" | "busy" | "unknown" | "unavailable";

const DOT_LABEL: Record<DotState, string> = {
  available: "Available",
  busy: "Busy",
  unknown: "Status unknown",
  unavailable: "Unavailable",
};

/** What the dot may claim: only a status the contact actually reported, and nothing once they are gone. */
export function dotStateFor(contact: Pick<ContactRecord, "presence" | "unavailable">): DotState {
  if (contact.unavailable) return "unavailable";
  return contact.presence ?? "unknown";
}

export function StatusDot({ state }: { state: DotState }) {
  // Distinct by color and shape: green disc, red ring with a bar, hollow grey ring, grey ring with a cross bar.
  const shape: Record<DotState, string> = {
    available: "inline-block h-3 w-3 shrink-0 rounded-full bg-accent ring-2 ring-paper-2",
    busy: "inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-error bg-bg",
    unknown: "inline-block h-3 w-3 shrink-0 rounded-full border-2 border-muted bg-bg",
    unavailable: "inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-muted bg-bg",
  };
  return (
    <span role="img" aria-label={DOT_LABEL[state]} data-status={state} className={shape[state]}>
      {state === "busy" ? <span className="h-0.5 w-1.5 bg-error" /> : null}
      {state === "unavailable" ? <span className="h-0.5 w-1.5 bg-muted" /> : null}
    </span>
  );
}

export interface ContactRowProps {
  contact: ContactRecord;
  onOpen: (contactPin: string) => void;
  /** Latest message of the conversation, shown instead of the personal message. */
  last?: MessageRecord;
  unread?: number;
  selected?: boolean;
}

/** One chat in the list: avatar with status, name, time, last message and unread count. */
export function ContactRow({ contact, onOpen, last, unread = 0, selected }: ContactRowProps) {
  const preview = last
    ? `${last.direction === "out" ? "You: " : ""}${last.text}`
    : contact.unavailable
      ? "No longer available"
      : contact.personalMessage;
  return (
    <button
      type="button"
      onClick={() => onOpen(contact.contactPin)}
      aria-current={selected ? "true" : undefined}
      className={`flex h-[72px] w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
        selected ? "bg-elevated" : "hover:bg-elevated/60"
      }`}
    >
      <span className="relative">
        <Avatar name={contact.displayName} picture={contact.picture} />
        <span className="absolute -bottom-0.5 -right-0.5 flex">
          <StatusDot state={dotStateFor(contact)} />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={`truncate font-semibold ${contact.unavailable ? "text-muted" : "text-text"}`}>
            {contact.displayName}
          </span>
          {last ? <span className="ml-auto shrink-0 text-xs text-muted">{formatListTime(last.ts)}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <span
            data-testid="personal-message"
            className={`min-w-0 flex-1 truncate whitespace-nowrap text-sm ${unread > 0 ? "text-text" : "text-muted"}`}
          >
            {preview}
          </span>
          {unread > 0 ? (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-on-accent">
              {unread}
              <span className="sr-only"> unread</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
