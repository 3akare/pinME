import { useEffect, useState } from "react";
import type { ContactRecord } from "../../client/storage";

/** Default placeholder picture: original artwork, first letter on a blue disc. */
function Avatar({ name, picture }: { name: string; picture?: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!picture) return;
    const u = URL.createObjectURL(picture);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [picture]);
  if (url) {
    return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden="true"
      data-testid="avatar-placeholder"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-strong text-lg font-bold text-white"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

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
    available: "inline-block h-3 w-3 shrink-0 rounded-full bg-green-400",
    busy: "inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-red-400 bg-bg",
    unknown: "inline-block h-3 w-3 shrink-0 rounded-full border-2 border-muted bg-bg",
    unavailable: "inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-muted bg-bg",
  };
  return (
    <span role="img" aria-label={DOT_LABEL[state]} data-status={state} className={shape[state]}>
      {state === "busy" ? <span className="h-0.5 w-1.5 bg-red-400" /> : null}
      {state === "unavailable" ? <span className="h-0.5 w-1.5 bg-muted" /> : null}
    </span>
  );
}

export interface ContactRowProps {
  contact: ContactRecord;
  onOpen: (contactPin: string) => void;
}

export function ContactRow({ contact, onOpen }: ContactRowProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(contact.contactPin)}
      className="flex h-16 w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Avatar name={contact.displayName} picture={contact.picture} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <StatusDot state={dotStateFor(contact)} />
          <span className="truncate font-semibold text-text">{contact.displayName}</span>
          {contact.unavailable ? <span className="text-xs text-muted">(unavailable)</span> : null}
        </span>
        <span data-testid="personal-message" className="truncate whitespace-nowrap text-sm text-muted">
          {contact.personalMessage}
        </span>
      </span>
    </button>
  );
}
