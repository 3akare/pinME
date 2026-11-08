import { bytesToBase64 } from "./base64";
import { isValidPin } from "./pin";

export type ScanResult = "accept" | "own-pin" | "invalid";

/** Path of an invite link: `/i/{PIN}`, with the optional auto-accept token in the fragment. */
export const INVITE_PATH = /^\/i\/([0-9A-F]{8})\/?$/;
/** Invite tokens are 16 random bytes in unpadded base64url. */
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export interface InviteTarget {
  pin: string;
  /** Present when the link came from the inviter's QR code or shared link (lets them auto-accept). */
  token?: string;
}

/** A fresh auto-accept token for an own PIN's invite link. */
export function newInviteToken(randomBytes: (n: number) => Uint8Array): string {
  return bytesToBase64(randomBytes(16)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Builds the link a QR code carries; any camera app opens it straight into the invite flow. */
export function inviteUrl(origin: string, pin: string, token?: string): string {
  return `${origin}/i/${pin}${token ? `#${token}` : ""}`;
}

/**
 * Reads what a scan or a paste produced: a bare PIN, or an invite link from any PinMe origin.
 * Returns null for anything else.
 */
export function parseInvite(text: string): InviteTarget | null {
  const raw = text.trim();
  if (isValidPin(raw)) return { pin: raw };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const m = INVITE_PATH.exec(url.pathname);
  if (!m) return null;
  const token = url.hash.slice(1);
  return INVITE_TOKEN.test(token) ? { pin: m[1]!, token } : { pin: m[1]! };
}

/**
 * Classify decoded barcode text.
 * - `accept`: a PIN or invite link for a PIN that is not one of the user's own PINs
 * - `own-pin`: one of the user's own PINs
 * - `invalid`: anything else
 */
export function classifyScan(text: string, ownPins: Iterable<string>): ScanResult {
  const target = isValidPin(text) ? { pin: text } : parseInvite(text);
  if (!target) return "invalid";
  for (const own of ownPins) {
    if (own === target.pin) return "own-pin";
  }
  return "accept";
}
