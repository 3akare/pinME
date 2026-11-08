/**
 * Transport keepalive. The PinMailbox answers HEARTBEAT_REQUEST with HEARTBEAT_RESPONSE through
 * `ctx.setWebSocketAutoResponse`, so the runtime replies without waking the Durable Object.
 * These strings are not protocol frames: the client socket consumes them before dispatch.
 */
export const HEARTBEAT_REQUEST = "hb";
export const HEARTBEAT_RESPONSE = "hb-ack";
/** Idle time before the client probes the connection. */
export const HEARTBEAT_INTERVAL_MS = 25_000;
/** A probe without any reply in this window marks the socket dead (half-open TCP, sleeping device). */
export const HEARTBEAT_TIMEOUT_MS = 10_000;
