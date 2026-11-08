export type Marker = "clock" | "D" | "R";

const ORDER: Record<Marker, number> = { clock: 0, D: 1, R: 2 };

/** Monotonic marker reducer: max over the order clock < D < R. */
export function advance(current: Marker, incoming: Marker): Marker {
  return ORDER[incoming] > ORDER[current] ? incoming : current;
}
