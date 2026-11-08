/** Protocol and policy constants shared by client and server. */
export const MAX_PLAINTEXT_CHARS = 4096;
export const MAX_CIPHERTEXT_BYTES = 8192;
export const MAX_BROADCAST_ENVELOPES = 100;

export const MESSAGE_RATE_LIMIT = 30;
export const MESSAGE_RATE_WINDOW_MS = 10_000;

export const PING_RATE_LIMIT = 1;
export const PING_RATE_WINDOW_MS = 10_000;

export const INVITE_RATE_LIMIT = 10;
export const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000;

export const SIGNED_REQUEST_SKEW_MS = 60_000;
export const NONCE_WINDOW_MS = 120_000;

export const MAX_ACTIVE_PINS = 20;

export const DISPLAY_NAME_MAX = 32;
export const PIN_LABEL_MAX = 24;
export const PERSONAL_MESSAGE_MAX = 80;

export const NONCE_BYTES = 24;
export const CHALLENGE_BYTES = 32;
