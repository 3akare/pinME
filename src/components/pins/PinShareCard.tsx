import { useEffect, useState } from "react";
import { usePinsStore } from "../../client/state/pins";
import { inviteUrl } from "../../shared/scan";
import { Barcode } from "./Barcode";

export interface PinShareCardProps {
  pin: string;
}

const COPIED_MS = 2000;

/** "My code": scanning it (in PinMe or with any phone camera) connects instantly, no accept step. */
export function PinShareCard({ pin }: PinShareCardProps) {
  const token = usePinsStore((s) => s.pins.find((p) => p.pin === pin)?.inviteToken);
  const [link, setLink] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  // Browser-only values are read after mount so the server render matches the first client render.
  useEffect(() => {
    setLink(token ? inviteUrl(location.origin, pin, token) : null);
    setCanShare(typeof navigator.share === "function");
  }, [pin, token]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function shareOrCopy() {
    if (!link) return;
    if (canShare) {
      try {
        await navigator.share({ title: "Chat with me on PinMe", url: link });
      } catch {
        // cancelled
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      document.querySelector<HTMLInputElement>("#my-link")?.select();
    }
  }

  return (
    <section aria-label="My code" className="flex w-full flex-col items-center gap-3">
      <p className="text-center text-muted">Scan to chat with me. No accept needed.</p>
      {link ? <Barcode pin={pin} value={link} /> : <p role="status" className="text-muted">Preparing your code…</p>}
      <div className="flex w-full max-w-sm gap-2">
        <label htmlFor="my-link" className="sr-only">
          My chat link
        </label>
        <input
          id="my-link"
          readOnly
          value={link ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs text-muted"
        />
        <button
          type="button"
          disabled={!link}
          onClick={() => void shareOrCopy()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {canShare ? "Share" : copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}
