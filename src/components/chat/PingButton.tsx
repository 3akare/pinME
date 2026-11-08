import { useEffect, useRef, useState } from "react";
import type { Dispatcher } from "../../client/net/dispatch";

/** Error frames arriving within this window after a ping are attributed to it. */
export const PING_ERROR_WINDOW_MS = 2000;
/** The not-delivered indication stays visible this long. */
export const NOT_DELIVERED_SHOW_MS = 4000;

const FAILURE_CODES = new Set(["not_delivered", "not_a_contact", "verification_unavailable", "pin_burned"]);

export interface PingButtonProps {
  /** Contact PIN to ping. */
  to: string;
  /** Sends a raw frame on the session (e.g. `session.send`). */
  send: (data: string) => void;
  /** Dispatcher used to observe `error` frames without replacing other handlers. */
  dispatcher?: Pick<Dispatcher, "listen">;
  disabled?: boolean;
  now?: () => number;
}

export function PingButton({ to, send, dispatcher, disabled, now = Date.now }: PingButtonProps) {
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [tick, setTick] = useState(0);
  const [notDelivered, setNotDelivered] = useState(false);
  const lastPing = useRef(-Infinity);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!dispatcher) return;
    const off = dispatcher.listen("error", (msg) => {
      const t = now();
      if (t - lastPing.current > PING_ERROR_WINDOW_MS) return;
      if (msg.code === "rate_limited") {
        const secs = msg.retryAfterSec ?? 10;
        setBlockedUntil(t + secs * 1000);
      } else if (FAILURE_CODES.has(msg.code)) {
        setNotDelivered(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setNotDelivered(false), NOT_DELIVERED_SHOW_MS);
      }
    });
    return () => {
      off();
      clearTimeout(hideTimer.current);
    };
  }, [dispatcher, now]);

  // Re-enable once the retry time has expired.
  useEffect(() => {
    const remaining = blockedUntil - now();
    if (remaining <= 0) return;
    const h = setTimeout(() => setTick((n) => n + 1), remaining);
    return () => clearTimeout(h);
  }, [blockedUntil, now]);
  void tick;

  const rateLimited = blockedUntil > now();

  function onClick(): void {
    if (disabled || rateLimited) return;
    setNotDelivered(false);
    lastPing.current = now();
    send(JSON.stringify({ type: "ping", to }));
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || rateLimited}
        aria-label="Send PING"
        className="rounded-xl border border-border px-3 py-2 font-semibold text-text hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        PING!
      </button>
      {notDelivered ? (
        <span role="status" aria-live="polite" className="text-xs text-muted">
          PING not delivered.
        </span>
      ) : null}
    </>
  );
}
