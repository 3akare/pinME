import { useState } from "react";
import type { BurnOutcome } from "../../client/pins/burn";
import { BurnDialog } from "./BurnDialog";
import { GhostAnimation } from "./GhostAnimation";
export interface BurnControlProps {
  pin: string;
  label: string;
  /** Runs the burn; call hooks.playAnimation to show the Ghost_Animation. */
  run: (hooks: { playAnimation: () => Promise<void> }) => Promise<BurnOutcome>;
}
/** Burn button plus confirmation dialog and ghost overlay. Cancel changes nothing. */
export function BurnControl({ pin, label, run }: BurnControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [ghost, setGhost] = useState<{ done: () => void } | null>(null);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const outcome = await run({
      playAnimation: () =>
        new Promise<void>((resolve) => {
          setOpen(false);
          setGhost({ done: resolve });
        }),
    });
    setGhost(null);
    setBusy(false);
    if (!outcome.ok) {
      setOpen(true);
      setError(outcome.message);
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
        className="rounded-xl border border-red-400 px-4 py-2 font-semibold text-red-300 hover:bg-red-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Burn this PIN
      </button>
      {open ? (
        <BurnDialog
          label={label}
          pin={pin}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={() => setOpen(false)}
        />
      ) : null}
      {ghost ? <GhostAnimation onComplete={ghost.done} /> : null}
    </div>
  );
}
