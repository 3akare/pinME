import { base64ToBytes, bytesToBase64 } from "../../shared/base64";
import { HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE } from "../../shared/heartbeat";
import { signChallenge } from "../crypto";
import { useConnectionStore, type ConnectionStatus } from "../state/connection";
import { createDispatcher, type Dispatcher } from "./dispatch";
import { connectSocket, type ReconnectingSocket, type ReconnectingSocketOptions } from "./socket";

/**
 * Authentication signal (the protocol has no explicit "authenticated" frame
 * and we may not add a twelfth type). After sending `challengeResponse` the
 * session is considered authenticated when EITHER
 *   (a) the first non-error, non-challenge frame arrives (the server only
 *       flushes held items or relays after authenticating), OR
 *   (b) the socket is still open with no `error` frame after AUTH_GRACE_MS.
 * An invalid signature makes the server close the socket (Req 6.6) before
 * either condition holds. An `error` frame or a close before the signal
 * means "not authenticated" and the backoff keeps growing.
 * On success the reconnect backoff is reset to 1000 ms (Req 6.11).
 * An `error(pin_unavailable)` stops reconnecting entirely (Req 6.10/6.12).
 */
export const AUTH_GRACE_MS = 1500;

export interface SessionOptions {
  /** Own PIN; keys this session's entry in the connection store. */
  pin: string;
  url: string;
  signSk: Uint8Array;
  dispatcher?: Dispatcher;
  graceMs?: number;
  /** Overrides for the underlying socket (tests). */
  socket?: Partial<ReconnectingSocketOptions>;
}

export interface Session {
  readonly dispatcher: Dispatcher;
  send(data: string): boolean;
  /** Runs after every successful authentication (first connect and each reconnect). */
  onAuthenticated(listener: () => void): () => void;
  /** Skips the backoff wait and reconnects now. */
  reconnect(): void;
  close(): void;
}

export function startSession(opts: SessionOptions): Session {
  const dispatcher = opts.dispatcher ?? createDispatcher();
  const grace = opts.graceMs ?? AUTH_GRACE_MS;
  const setStatus = (status: ConnectionStatus) => {
    if (!closedByUser) useConnectionStore.getState().setStatus(opts.pin, status);
  };
  let authenticated = false;
  let unavailable = false;
  let closedByUser = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let socket: ReconnectingSocket | null = null;
  const authListeners = new Set<() => void>();

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const markAuthenticated = () => {
    if (authenticated) return;
    authenticated = true;
    clearTimer();
    socket?.resetBackoff();
    setStatus("connected");
    for (const l of [...authListeners]) {
      try {
        l();
      } catch {
        // a listener failing must not affect the session
      }
    }
  };

  setStatus("connecting");
  socket = connectSocket({
    url: opts.url,
    heartbeat: { request: HEARTBEAT_REQUEST, response: HEARTBEAT_RESPONSE },
    ...opts.socket,
    onOpen: () => {
      authenticated = false;
      clearTimer();
      setStatus("connecting");
    },
    onMessage: (raw) => {
      if (closedByUser) return;
      const msg = dispatcher.dispatch(raw);
      if (!msg) return;
      if (msg.type === "challenge") {
        const sig = signChallenge(base64ToBytes(msg.challenge), opts.signSk);
        socket?.send(JSON.stringify({ type: "challengeResponse", signature: bytesToBase64(sig) }));
        setStatus("authenticating");
        clearTimer();
        timer = setTimeout(markAuthenticated, grace);
      } else if (msg.type === "error") {
        if (msg.code === "pin_unavailable") {
          unavailable = true;
          clearTimer();
          setStatus("unavailable");
        } else if (!authenticated) {
          clearTimer(); // rejected during handshake
        }
      } else {
        markAuthenticated();
      }
    },
    onClose: () => {
      clearTimer();
      authenticated = false;
      setStatus(unavailable ? "unavailable" : "disconnected");
    },
    shouldReconnect: () => !unavailable && !closedByUser,
  });

  return {
    dispatcher,
    send: (data) => authenticated && !!socket?.send(data),
    onAuthenticated(listener) {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
    reconnect: () => socket?.reconnectNow(),
    close() {
      if (closedByUser) return;
      clearTimer();
      socket?.close();
      closedByUser = true;
      authListeners.clear();
      useConnectionStore.getState().clear(opts.pin);
    },
  };
}
