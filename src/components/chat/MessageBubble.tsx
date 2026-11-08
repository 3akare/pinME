import type { Marker } from "../../shared/marker";

export function DeliveryMarker({ marker }: { marker: Marker }) {
  if (marker === "clock") {
    return (
      <span role="img" aria-label="Sending" data-marker="clock" className="shrink-0 self-end">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
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
      className="shrink-0 self-end text-xs font-bold leading-none"
    >
      {marker}
    </span>
  );
}

export interface MessageBubbleProps {
  direction: "in" | "out";
  text: string;
  marker?: Marker;
}

/** Sent bubbles align right and carry a Delivery_Marker; received bubbles align left without one. */
export function MessageBubble({ direction, text, marker }: MessageBubbleProps) {
  const sent = direction === "out";
  return (
    <div
      data-testid="message-bubble"
      data-direction={direction}
      className={`flex w-full ${sent ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`flex max-w-[85%] items-start gap-2 rounded-2xl px-3 py-2 ${
          sent ? "bg-accent-strong text-white" : "border border-border bg-surface text-text"
        }`}
      >
        <p className="min-w-0 whitespace-pre-wrap break-words">{text}</p>
        {sent ? <DeliveryMarker marker={marker ?? "clock"} /> : null}
      </div>
    </div>
  );
}
