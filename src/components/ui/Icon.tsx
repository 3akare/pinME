const PATHS = {
  scan: "M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z",
  send: "M4 12l16-8-6 16-2-7-8-1z",
  back: "M15 5l-7 7 7 7",
  bolt: "M13 3L5 14h6l-1 7 8-11h-6l1-7z",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  close: "M6 6l12 12M18 6L6 18",
  pins: "M7 4h10v4l-2 3v5l-3 4-3-4v-5L7 8z",
  broadcast: "M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  check: "M5 12l5 5 9-10",
} as const;

export type IconName = keyof typeof PATHS;

/** Line icons drawn with currentColor; decorative unless the parent labels them. */
export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
