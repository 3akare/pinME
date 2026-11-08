import { useEffect, useRef, useState } from "react";
import type { Dispatcher } from "../../client/net/dispatch";
import { Icon } from "../ui/Icon";

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
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || rateLimited}
        aria-label="Send PING"
        title="PING: shakes their screen"
        className="icon-btn h-11 w-11 shrink-0"
      >
        <Icon name="bolt" />
      </button>
      {notDelivered ? (
        <span
          role="status"
          aria-live="polite"
          className="absolute bottom-full left-0 mb-2 whitespace-nowrap rounded-pill bg-paper-3 px-3 py-1 text-xs text-ink"
        >
          PING not delivered.
        </span>
      ) : null}
    </span>
  );
}
