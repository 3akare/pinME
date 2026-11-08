import { startSession, type Session, type SessionOptions } from "./session";

export interface ManagedPin {
  pin: string;
  signSk: Uint8Array;
  status?: "active" | "burned";
}

export interface ConnectionManagerDeps {
  /** Builds the WebSocket URL for a PIN. */
  urlFor: (pin: string) => string;
  start?: (opts: SessionOptions) => Session;
  /**
   * Wires frame handlers onto a new session. The returned teardown runs before the
   * session closes, so subscriptions and timers never outlive their socket.
   */
  setup?: (pin: string, session: Session) => (() => void) | void;
}

export interface ConnectionManager {
  /** Starts a session for the PIN unless one already exists (never two). */
  add(pin: ManagedPin): Session | undefined;
  /** Tears down and closes the PIN's session. */
  remove(pin: string): void;
  /** Starts/stops sessions so exactly one exists per active PIN. */
  sync(pins: ManagedPin[]): void;
  get(pin: string): Session | undefined;
  has(pin: string): boolean;
  pins(): string[];
  closeAll(): void;
}

/** Keeps exactly one WebSocket session per active PIN. */
export function createConnectionManager(deps: ConnectionManagerDeps): ConnectionManager {
  const start = deps.start ?? startSession;
  const sessions = new Map<string, { session: Session; teardown?: () => void }>();

  const remove = (pin: string) => {
    const entry = sessions.get(pin);
    if (!entry) return;
    sessions.delete(pin);
    try {
      entry.teardown?.();
    } finally {
      entry.session.close();
    }
  };
  const add = (p: ManagedPin) => {
    if (p.status === "burned") return undefined;
    const existing = sessions.get(p.pin);
    if (existing) return existing.session;
    const session = start({ pin: p.pin, url: deps.urlFor(p.pin), signSk: p.signSk });
    sessions.set(p.pin, { session, teardown: deps.setup?.(p.pin, session) ?? undefined });
    return session;
  };

  return {
    add,
    remove,
    sync(pins) {
      const wanted = new Set(pins.filter((p) => p.status !== "burned").map((p) => p.pin));
      for (const pin of [...sessions.keys()]) if (!wanted.has(pin)) remove(pin);
      for (const p of pins) add(p);
    },
    get: (pin) => sessions.get(pin)?.session,
    has: (pin) => sessions.has(pin),
    pins: () => [...sessions.keys()],
    closeAll() {
      for (const pin of [...sessions.keys()]) remove(pin);
    },
  };
}
