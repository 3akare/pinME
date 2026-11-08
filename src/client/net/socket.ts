import { BACKOFF_START_MS, nextDelay } from "../../shared/backoff";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from "../../shared/heartbeat";

export interface HeartbeatOptions {
  request: string;
  response: string;
  intervalMs?: number;
  timeoutMs?: number;
}

/** Browser hooks the socket listens to; injectable so tests can drive them. */
export interface SocketEnvironment {
  addEventListener(type: "online" | "offline", fn: () => void): void;
  removeEventListener(type: "online" | "offline", fn: () => void): void;
  onVisible(fn: () => void): () => void;
}

export interface ReconnectingSocketOptions {
  url: string;
  onOpen?: () => void;
  onMessage?: (data: string) => void;
  onClose?: () => void;
  /** Return false to stop reconnecting after a close. */
  shouldReconnect?: () => boolean;
  /** Probe an idle connection and drop it when the probe goes unanswered. */
  heartbeat?: HeartbeatOptions;
  env?: SocketEnvironment | null;
  random?: () => number;
}

export interface ReconnectingSocket {
  send(data: string): boolean;
  /** Call after successful authentication to reset the backoff to 1000 ms. */
  resetBackoff(): void;
  /** Skip a pending backoff wait and connect now (no-op while open or connecting). */
  reconnectNow(): void;
  close(): void;
  readonly currentDelay: number;
}

/** Up to +25 % random spread so many sessions do not reconnect in lockstep. */
const JITTER = 0.25;

function browserEnvironment(): SocketEnvironment | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return {
    addEventListener: (type, fn) => window.addEventListener(type, fn),
    removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    onVisible(fn) {
      const listener = () => {
        if (document.visibilityState === "visible") fn();
      };
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export function connectSocket(opts: ReconnectingSocketOptions): ReconnectingSocket {
  const env = opts.env === undefined ? browserEnvironment() : opts.env;
  const random = opts.random ?? Math.random;
  const hb = opts.heartbeat;
  let ws: WebSocket | null = null;
  let delay = BACKOFF_START_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clearHeartbeat = () => {
    if (probeTimer) clearTimeout(probeTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    probeTimer = deadlineTimer = null;
  };

  /** Any inbound traffic proves liveness; schedule the next probe from now. */
  const armHeartbeat = () => {
    if (!hb) return;
    clearHeartbeat();
    probeTimer = setTimeout(probe, hb.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  };

  const probe = () => {
    if (!hb || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = null;
    try {
      ws.send(hb.request);
    } catch {
      drop();
      return;
    }
    deadlineTimer ??= setTimeout(drop, hb.timeoutMs ?? HEARTBEAT_TIMEOUT_MS);
  };

  const scheduleReconnect = () => {
    if (stopped || opts.shouldReconnect?.() === false) return;
    const wait = Math.round(delay * (1 + random() * JITTER));
    delay = nextDelay(delay);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, wait);
  };

  /** Detaches the socket so its late events are ignored, then treats it as closed. */
  const drop = () => {
    const dead = ws;
    if (!dead) return;
    ws = null;
    clearHeartbeat();
    dead.onopen = dead.onmessage = dead.onclose = dead.onerror = null;
    try {
      dead.close();
    } catch {
      // already closing
    }
    opts.onClose?.();
    scheduleReconnect();
  };

  const open = () => {
    if (stopped || ws) return;
    const sock = new WebSocket(opts.url);
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      armHeartbeat();
      opts.onOpen?.();
    };
    sock.onmessage = (ev) => {
      if (ws !== sock || typeof ev.data !== "string") return;
      armHeartbeat();
      if (hb && ev.data === hb.response) return;
      opts.onMessage?.(ev.data);
    };
    sock.onclose = () => {
      if (ws === sock) drop();
    };
  };

  const reconnectNow = () => {
    if (stopped || opts.shouldReconnect?.() === false) return;
    delay = BACKOFF_START_MS;
    if (ws) return; // an attempt is already in flight; a failure now retries after 1 s
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    open();
  };

  // Coming back online or to the foreground: reconnect at once, or verify an open socket.
  const onOnline = () => reconnectNow();
  const onOffline = () => drop();
  const onVisible = () => (ws ? probe() : reconnectNow());
  env?.addEventListener("online", onOnline);
  env?.addEventListener("offline", onOffline);
  const offVisible = env?.onVisible(onVisible);

  open();

  return {
    send(data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        return true;
      }
      return false;
    },
    resetBackoff() {
      delay = BACKOFF_START_MS;
    },
    reconnectNow,
    close() {
      if (stopped) return;
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      env?.removeEventListener("online", onOnline);
      env?.removeEventListener("offline", onOffline);
      offVisible?.();
      const sock = ws;
      ws = null;
      clearHeartbeat();
      if (sock) {
        sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
        sock.close();
      }
    },
    get currentDelay() {
      return delay;
    },
  };
}
