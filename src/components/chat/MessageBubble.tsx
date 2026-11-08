import { formatTime } from "../../client/chat/format";
import type { Marker } from "../../shared/marker";

export function DeliveryMarker({ marker }: { marker: Marker }) {
  if (marker === "clock") {
    return (
      <span role="img" aria-label="Sending" data-marker="clock" className="shrink-0">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={marker === "D" ? "Delivered" : "Read"}
      data-marker={marker}
      className={`shrink-0 text-xs font-semibold leading-none ${marker === "R" ? "text-accent" : ""}`}
    >
      {marker}
    </span>
  );
}

export interface MessageBubbleProps {
  direction: "in" | "out";
  text: string;
  marker?: Marker;
  ts?: number;
  /** Fixed time text instead of formatting `ts` (server-rendered demos must not depend on locale). */
  timeText?: string;
  /** Written while offline; goes out on reconnect. */
  pending?: boolean;
  /** Refused by the relay for good. */
  failed?: boolean;
  /** Group messages have no single recipient to report D or R, so they show none. */
  showMarker?: boolean;
}

/** Sent bubbles sit right on the lifted paper with time and Delivery_Marker; received sit left. */
export function MessageBubble({ direction, text, marker, ts, timeText, pending, failed, showMarker = true }: MessageBubbleProps) {
  const sent = direction === "out";
  return (
    <div
      data-testid="message-bubble"
      data-direction={direction}
      className={`flex w-full ${sent ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`flex max-w-[78%] flex-col gap-1 px-3.5 py-2 ${
          sent ? "rounded-[18px] rounded-br-md bg-paper-3 text-ink" : "rounded-[18px] rounded-bl-md bg-paper-2 text-ink"
        }`}
      >
        <p className="min-w-0 whitespace-pre-wrap break-words">{text}</p>
        <span className={`flex items-center gap-1.5 self-end text-xs ${failed ? "text-error" : "text-muted"}`}>
          {failed ? "Not delivered" : pending ? "Waiting for connection" : null}
          {timeText ? <span>{timeText}</span> : ts !== undefined ? <time dateTime={new Date(ts).toISOString()}>{formatTime(ts)}</time> : null}
          {sent && !failed && showMarker ? <DeliveryMarker marker={marker ?? "clock"} /> : null}
        </span>
      </div>
    </div>
  );
}
