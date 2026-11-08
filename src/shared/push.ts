/**
 * Web Push for PinMe: empty "wake-up" pushes only. The push carries no payload, so neither the
 * push service nor this server ever holds message content; the phone shows a generic notice and
 * the real items arrive over the encrypted socket when the app opens.
 */
import { base64ToBytes, bytesToBase64 } from "./base64";

/** Push services a subscription may point at; anything else is refused (no arbitrary POSTs). */
export const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
] as const;

/** At most one wake-up per mailbox in this window; a burst of messages is one buzz. */
export const PUSH_THROTTLE_MS = 60_000;
/** Push services keep an undelivered wake-up this long. */
export const PUSH_TTL_SEC = 86_400;

/** True for an https endpoint on a known push service. */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

const b64url = (bytes: Uint8Array) => bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => new TextEncoder().encode(s);

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (what the browser's applicationServerKey takes). */
  publicKey: string;
  /** Private scalar `d`, base64url. */
  privateKey: string;
  /** `mailto:` or `https:` contact for the push service. */
  subject: string;
}

/** `Authorization` header value for one push service origin (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowMs: number): Promise<string> {
  const pub = base64ToBytes(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("vapid_public_key");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    d: keys.privateKey,
    ext: false,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: keys.subject })),
  );
  const input = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(input)));
  return `vapid t=${input}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Sends one empty wake-up. Resolves with the push service's HTTP status (404/410: subscription gone). */
export async function sendWakeUp(
  endpoint: string,
  keys: VapidKeys,
  nowMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(endpoint, keys, nowMs),
      TTL: String(PUSH_TTL_SEC),
      Urgency: "high",
      "Content-Length": "0",
    },
  });
  return res.status;
}
