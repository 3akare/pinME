import { create } from "zustand";

/**
 * - idle: no socket
 * - connecting: socket opening or waiting for the challenge
 * - authenticating: challengeResponse sent, no verdict yet
 * - connected: authenticated (see src/client/net/session.ts for the signal)
 * - disconnected: socket closed, a reconnect is scheduled
 * - unavailable: server sent pin_unavailable; reconnecting is stopped
 */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "disconnected"
  | "unavailable";

interface ConnectionState {
  /** Status per own PIN. Each PIN has its own socket, so one PIN's state never masks another's. */
  byPin: Record<string, ConnectionStatus>;
  setStatus(pin: string, status: ConnectionStatus): void;
  /** Forgets a PIN whose session was closed for good. */
  clear(pin: string): void;
  reset(): void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  byPin: {},
  setStatus: (pin, status) =>
    set((s) => (s.byPin[pin] === status ? s : { byPin: { ...s.byPin, [pin]: status } })),
  clear: (pin) =>
    set((s) => {
      if (!(pin in s.byPin)) return s;
      const { [pin]: _removed, ...rest } = s.byPin;
      return { byPin: rest };
    }),
  reset: () => set({ byPin: {} }),
}));

export const statusOf = (pin: string | null | undefined): ConnectionStatus =>
  (pin && useConnectionStore.getState().byPin[pin]) || "idle";

/** React selector for one PIN's status. */
export const useConnectionStatus = (pin: string | null | undefined): ConnectionStatus =>
  useConnectionStore((s) => (pin && s.byPin[pin]) || "idle");

/** Chat sending is allowed only while that PIN's session is authenticated. */
export const isConnected = (pin: string): boolean => statusOf(pin) === "connected";
