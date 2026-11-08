const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clock time for a bubble, e.g. "14:05". */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Time for a chat list row: clock time today, "Yesterday", weekday this week, else a short date. */
export function formatListTime(ts: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (days <= 0) return formatTime(ts);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
