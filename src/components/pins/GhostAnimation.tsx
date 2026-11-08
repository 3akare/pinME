import { useEffect } from "react";
import { Ghost } from "../ui/Ghost";
export const GHOST_DURATION_MS = 1600;
export const GHOST_REDUCED_DURATION_MS = 300;
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
export interface GhostAnimationProps {
  onComplete: () => void;
  /** Override for tests; defaults to the media query. */
  reducedMotion?: boolean;
}
/** Ghost_Animation played after a successful burn. Calls onComplete exactly once. */
export function GhostAnimation({ onComplete, reducedMotion }: GhostAnimationProps) {
  const reduced = reducedMotion ?? prefersReducedMotion();
  useEffect(() => {
    const t = setTimeout(onComplete, reduced ? GHOST_REDUCED_DURATION_MS : GHOST_DURATION_MS);
    return () => clearTimeout(t);
  }, [reduced]);
  return (
    <div className="pinme-ghost-overlay" role="status" aria-live="polite" data-testid="ghost-animation">
      <Ghost className="pinme-ghost" />
      <span className="sr-only">PIN burned</span>
    </div>
  );
}
