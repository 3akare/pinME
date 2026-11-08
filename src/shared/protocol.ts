import { z } from "zod";
import { decodedLength } from "./base64";
import {
  CHALLENGE_BYTES,
  MAX_BROADCAST_ENVELOPES,
  MAX_CIPHERTEXT_BYTES,
  NONCE_BYTES,
  PERSONAL_MESSAGE_MAX,
} from "./limits";
import { PIN_REGEX } from "./pin";

/** The protocol has exactly these eleven types. Do not add a twelfth. */
export const MESSAGE_TYPES = [
  "challenge",
  "challengeResponse",
  "message",
  "delivered",
  "read",
  "typing",
  "ping",
  "broadcast",
  "inviteNotice",
  "contactBurned",
  "error",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const ERROR_CODES = [
  "validation_failed",
  "pin_unavailable",
  "not_a_contact",
  "rate_limited",
  "verification_unavailable",
  "pin_burned",
  "not_found",
  "self_invite",
  "duplicate",
  "invalid_signature",
  "expired_timestamp",
  "replay",
  "unknown_pin",
  "private_key_not_accepted",
  "collision",
  "db_not_configured",
  "envelope_limit_exceeded",
  "not_delivered",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const PinSchema = z.string().regex(PIN_REGEX);
export const MessageIdSchema = z.uuid();
const b64 = z.string().regex(/^[A-Za-z0-9+/_-]+={0,2}$/);
const b64Exact = (bytes: number) => b64.refine((s) => decodedLength(s) === bytes);

export const EnvelopeSchema = z.strictObject({
  to: PinSchema,
  messageId: MessageIdSchema,
  nonce: b64Exact(NONCE_BYTES),
  // 8192 bytes accepted, 8193 rejected
  ciphertext: b64.refine((c) => decodedLength(c) <= MAX_CIPHERTEXT_BYTES),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

const t = <T extends MessageType>(type: T) => z.literal(type);

// Individual frame schemas (each defined once).
const challengeFrame = z.strictObject({ type: t("challenge"), challenge: b64Exact(CHALLENGE_BYTES) });
const challengeResponseFrame = z.strictObject({ type: t("challengeResponse"), signature: b64Exact(64) });
const typingFrame = z.strictObject({ type: t("typing"), from: PinSchema });
const inviteNoticeFrame = z.strictObject({
  type: t("inviteNotice"),
  kind: z.enum(["invite", "accepted", "presence"]),
  from: PinSchema,
  inviteId: z.uuid().optional(),
  status: z.enum(["available", "busy"]).optional(),
  personalMessage: z.string().max(PERSONAL_MESSAGE_MAX).optional(),
});
const contactBurnedFrame = z.strictObject({ type: t("contactBurned"), pin: PinSchema });
const errorFrame = z.strictObject({
  type: t("error"),
  code: ErrorCode,
  ref: z.string().max(64).optional(),
  field: z.string().max(64).optional(),
  retryAfterSec: z.number().int().nonnegative().optional(),
  /** Rejected recipient PIN for per-envelope broadcast errors. */
  to: PinSchema.optional(),
});

/** Server to client. */
export const ServerMsg = z.discriminatedUnion("type", [
  challengeFrame,
  z.strictObject({ type: t("message"), from: PinSchema, envelope: EnvelopeSchema }),
  z.strictObject({ type: t("delivered"), from: PinSchema, messageId: MessageIdSchema }),
  z.strictObject({ type: t("read"), from: PinSchema, messageId: MessageIdSchema }),
  typingFrame,
  z.strictObject({ type: t("ping"), from: PinSchema }),
  inviteNoticeFrame,
  contactBurnedFrame,
  errorFrame,
]);
export type ServerMsg = z.infer<typeof ServerMsg>;

/** Client to server: challengeResponse, message, broadcast, delivered, read, typing, ping. */
export const ClientMsg = z.discriminatedUnion("type", [
  challengeResponseFrame,
  z.strictObject({ type: t("message"), envelope: EnvelopeSchema }),
  z.strictObject({
    type: t("broadcast"),
    envelopes: z.array(EnvelopeSchema).min(1).max(MAX_BROADCAST_ENVELOPES),
  }),
  z.strictObject({ type: t("delivered"), to: PinSchema, messageId: MessageIdSchema }),
  z.strictObject({ type: t("read"), to: PinSchema, messageId: MessageIdSchema }),
  z.strictObject({ type: t("typing"), to: PinSchema }),
  z.strictObject({ type: t("ping"), to: PinSchema }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export type Direction = "server" | "client";

export type ParseFailure =
  | { ok: false; reason: "invalid_json" }
  | { ok: false; reason: "unknown_type" }
  | { ok: false; reason: "validation_failed"; type: MessageType; field: string };
export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

function isKnownType(v: unknown): v is MessageType {
  return typeof v === "string" && (MESSAGE_TYPES as readonly string[]).includes(v);
}

/**
 * Parse a raw frame. `direction` selects which side's schema applies:
 * "server" validates frames sent by the server (client receiving),
 * "client" validates frames sent by the client (server receiving).
 * Failures expose only the message type and failed field name, never content.
 */
export function parseFrame(raw: unknown, direction: "server"): ParseResult<ServerMsg>;
export function parseFrame(raw: unknown, direction: "client"): ParseResult<ClientMsg>;
export function parseFrame(raw: unknown, direction: Direction): ParseResult<ServerMsg | ClientMsg>;
export function parseFrame(raw: unknown, direction: Direction): ParseResult<ServerMsg | ClientMsg> {
  let json: unknown;
  try {
    json = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (typeof raw !== "string" && (raw === undefined || raw instanceof ArrayBuffer || ArrayBuffer.isView(raw))) {
    return { ok: false, reason: "invalid_json" };
  }
  const type = json !== null && typeof json === "object" ? (json as { type?: unknown }).type : undefined;
  if (!isKnownType(type)) return { ok: false, reason: "unknown_type" };

  const schema = direction === "server" ? ServerMsg : ClientMsg;
  const res = schema.safeParse(json);
  if (res.success) return { ok: true, value: res.data };

  const issue = res.error.issues[0];
  const path = issue?.path ?? [];
  // A type that is valid but not allowed in this direction fails on "type".
  const field = path.length > 0 ? path.map(String).join(".") : issue?.code === "unrecognized_keys" ? "unrecognized" : "type";
  return { ok: false, reason: "validation_failed", type, field: sanitizeField(field) };
}

function sanitizeField(field: string): string {
  return /^[A-Za-z0-9_.]{1,64}$/.test(field) ? field : "unknown";
}
