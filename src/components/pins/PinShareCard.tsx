import { useEffect, useState } from "react";
import { useConnectionStatus, type ConnectionStatus } from "../../client/state/connection";
import { Barcode } from "./Barcode";

export interface PinShareCardProps {
  pin: string;
  /** Own PIN label, e.g. "Main". */
  label?: string;
}

const COPIED_MS = 2000;

/** Link that opens Add contact with this PIN filled in. */
export function inviteLinkFor(origin: string, pin: string): string {
  return `${origin}/add?pin=${pin}`;
}

function readiness(status: ConnectionStatus): { text: string; tone: string } {
  switch (status) {
    case "connected":
      return { text: "Ready: invites to this PIN pop up here as soon as they are sent.", tone: "bg-green-400" };
    case "unavailable":
      return { text: "This PIN is no longer reachable.", tone: "bg-red-400" };
    case "disconnected":
      return { text: "Offline. Invites are held for you and appear once you reconnect.", tone: "bg-muted" };
    default:
      return { text: "Connecting...", tone: "bg-muted" };
  }
}

/** QR code plus what to do with it: how a contact connects and what happens next on this device. */
export function PinShareCard({ pin, label }: PinShareCardProps) {
  const status = useConnectionStatus(pin);
  const [link, setLink] = useState<string | null>(null);
  /** Feedback after a copy attempt; `manual` is shown selectable when the clipboard is blocked. */
  const [copied, setCopied] = useState<{ text: string; manual?: string } | null>(null);
  const [canShare, setCanShare] = useState(false);

  // Browser-only values are read after mount so the server render matches the first client render.
  useEffect(() => {
    setLink(inviteLinkFor(location.origin, pin));
    setCanShare(typeof navigator.share === "function");
  }, [pin]);
  useEffect(() => {
    if (!copied || copied.manual) return;
    const t = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy(value: string, what: "PIN" | "Invite link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied({ text: `${what} copied.` });
    } catch {
      setCopied({ text: "Copying is blocked here. Select and copy:", manual: value });
    }
  }

  async function share() {
    if (!link) return;
    try {
      await navigator.share({ title: "Chat with me on PinMe", text: `Add me on PinMe: ${pin}`, url: link });
    } catch {
      // Cancelled by the user.
    }
  }

  const ready = readiness(status);
  const btn =
    "rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

  return (
    <section aria-label={`Share ${label ?? "your"} PIN`} className="flex w-full flex-col items-center gap-4">
      <Barcode pin={pin} />
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={btn} onClick={() => void copy(pin, "PIN")}>
          Copy PIN
        </button>
        <button type="button" className={btn} disabled={!link} onClick={() => link && void copy(link, "Invite link")}>
          Copy invite link
        </button>
        {canShare ? (
          <button type="button" className={btn} disabled={!link} onClick={() => void share()}>
            Share...
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="-my-2 min-h-5 max-w-full text-center text-sm text-muted">
        {copied?.text}
        {copied?.manual ? (
          <>
            {" "}
            <code className="select-all break-all rounded bg-bg px-1 font-mono text-text">{copied.manual}</code>
          </>
        ) : null}
      </p>
      <div className="w-full rounded-2xl border border-border bg-surface p-4 text-sm">
        <h2 className="font-semibold text-text">How someone adds you</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>They open PinMe and choose Add contact.</li>
          <li>They scan this code, type the PIN, or open your invite link.</li>
          <li>You get a prompt on this device to accept. Their chat opens right away.</li>
        </ol>
        <p className="mt-3 flex items-center gap-2 text-muted" data-connection={status}>
          <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${ready.tone}`} />
          <span>{ready.text}</span>
        </p>
      </div>
    </section>
  );
}
