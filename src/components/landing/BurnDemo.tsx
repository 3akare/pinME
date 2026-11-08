import { useState } from "react";
import { Ghost } from "../ui/Ghost";

const DEMO_PIN = "2A4F9C1B";

/**
 * The page's signature: a PIN at poster size that you can burn on the spot.
 * Nothing is sent anywhere; it shows what burning does to everyone who had it.
 */
export function BurnDemo() {
  const [burned, setBurned] = useState(false);

  return (
    <div className="grained flex flex-col gap-6 rounded-card bg-paper-2 p-6 [container-type:inline-size] sm:p-10 md:min-h-[max(520px,66vh)]">
      <p className="relative z-[2] text-ink-2">Your Marketplace PIN</p>

      <div aria-live="polite" className="relative z-[2] flex flex-1 items-center">
        {burned ? (
          <div className="flex items-center gap-6">
            <Ghost className="burn-ghost w-[18cqw] shrink-0 text-ink" />
            <p className="font-display text-[8cqw] leading-[1.05] text-ink">Burned. Everyone who had it is cut off.</p>
          </div>
        ) : (
          <p
            aria-label={`PIN ${DEMO_PIN}`}
            className="font-display text-[33cqw] leading-[0.86] text-ink [font-variant-numeric:lining-nums_tabular-nums]"
          >
            <span className="block">{DEMO_PIN.slice(0, 4)}</span>
            <span className="block">{DEMO_PIN.slice(4)}</span>
          </p>
        )}
      </div>

      <dl className="relative z-[2] border-t border-rule text-sm">
        <div className="flex justify-between gap-4 border-b border-rule py-2.5">
          <dt className="text-muted">Who has it</dt>
          <dd className="text-right text-ink-2">{burned ? "Nobody, from now on" : "A seller, a rider, a group chat"}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-rule py-2.5">
          <dt className="text-muted">Your phone number</dt>
          <dd className="text-right text-ink-2">Never shared</dd>
        </div>
      </dl>

      <div className="relative z-[2] flex justify-end">
        {burned ? (
          <button type="button" className="btn btn--quiet" onClick={() => setBurned(false)}>
            Show it again
          </button>
        ) : (
          <button type="button" className="btn btn--quiet" onClick={() => setBurned(true)}>
            Burn this PIN
          </button>
        )}
      </div>
    </div>
  );
}
