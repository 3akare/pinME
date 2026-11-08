/** Pure signed-challenge handshake logic for PinMailbox (Req 6.2-6.9, 6.12, 15.2). */
import { base64ToBytes, bytesToBase64 } from "../shared/base64";
import { verifyEd25519 } from "../shared/ed25519";
import { CHALLENGE_BYTES } from "../shared/limits";
import { parseFrame, type ServerMsg } from "../shared/protocol";
import type { DirectoryClient } from "./directoryClient";

export const CHALLENGE_TIMEOUT_MS = 10_000;
export const CLOSE_POLICY = 1008;

/** Per-socket state kept in `ws.serializeAttachment()` so it survives hibernation. */
export interface SocketAttachment {
  pin: string;
  authenticated: boolean;
  challenge: string; // base64, 32 bytes; empty once authenticated
  challengeExpiresAt: number; // epoch ms
}

export type ConnectOutcome =
  | { kind: "reject"; frame: ServerMsg }
  | { kind: "challenge"; frame: ServerMsg; attachment: SocketAttachment };

/**
 * Decide what a new connection for `pin` receives. Unregistered or burned PINs
 * get `pin_unavailable` and no challenge. If the Directory is unreachable the
 * connection fails closed.
 */
export async function beginConnection(
  pin: string,
  directory: DirectoryClient,
  randomBytes: (n: number) => Uint8Array,
  now: number,
): Promise<ConnectOutcome> {
  let record;
  try {
    record = await directory.lookupPin(pin);
  } catch {
    return { kind: "reject", frame: { type: "error", code: "verification_unavailable" } };
  }
  if (record.state !== "active") {
    return { kind: "reject", frame: { type: "error", code: "pin_unavailable" } };
  }
  const challenge = bytesToBase64(randomBytes(CHALLENGE_BYTES));
  return {
    kind: "challenge",
    frame: { type: "challenge", challenge },
    attachment: { pin, authenticated: false, challenge, challengeExpiresAt: now + CHALLENGE_TIMEOUT_MS },
  };
}

export type AuthOutcome =
  | { kind: "ignored" }
  | { kind: "authenticated"; attachment: SocketAttachment }
  | { kind: "close"; frame: ServerMsg };

/**
 * Handle a frame on an unauthenticated socket. Everything except a valid
 * `challengeResponse` is ignored without any state change or reply.
 */
export async function handleUnauthenticated(
  attachment: SocketAttachment,
  raw: string | ArrayBuffer,
  directory: DirectoryClient,
  now: number,
): Promise<AuthOutcome> {
  if (attachment.authenticated) return { kind: "ignored" };
  if (typeof raw !== "string") return { kind: "ignored" };
  const parsed = parseFrame(raw, "client");
  if (!parsed.ok || parsed.value.type !== "challengeResponse") return { kind: "ignored" };
  if (now >= attachment.challengeExpiresAt) {
    return { kind: "close", frame: { type: "error", code: "invalid_signature" } };
  }
  let record;
  try {
    record = await directory.lookupPin(attachment.pin);
  } catch {
    return { kind: "close", frame: { type: "error", code: "verification_unavailable" } };
  }
  if (record.state !== "active") {
    return { kind: "close", frame: { type: "error", code: "pin_unavailable" } };
  }
  const { signPublicKey } = record;
  const { signature } = parsed.value;
  const ok = await (async () =>
    verifyEd25519(base64ToBytes(signPublicKey), base64ToBytes(attachment.challenge), base64ToBytes(signature)))().catch(
    () => false,
  );
  if (!ok) return { kind: "close", frame: { type: "error", code: "invalid_signature" } };
  return { kind: "authenticated", attachment: { ...attachment, authenticated: true, challenge: "" } };
}

/** True when an unauthenticated socket has passed its challenge deadline. */
export function isExpired(attachment: SocketAttachment, now: number): boolean {
  return !attachment.authenticated && now >= attachment.challengeExpiresAt;
}
