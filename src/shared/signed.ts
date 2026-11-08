import { z } from "zod";
import { decodedLength } from "./base64";
import { PIN_REGEX } from "./pin";

export const SIGNED_ACTIONS = [
  "burn",
  "updateProfile",
  "sendInvite",
  "respondInvite",
  "registerPush",
  "createGroup",
  "leaveGroup",
  "publishPrekeys",
  "getPrekeys",
] as const;

export const SignedActionSchema = z.enum(SIGNED_ACTIONS);
export type SignedAction = z.infer<typeof SignedActionSchema>;

export const NONCE_MIN_BYTES = 16;

const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export const SignedRequestSchema = z.object({
  pin: z.string().regex(PIN_REGEX),
  action: SignedActionSchema,
  ts: z.number().int().nonnegative(),
  nonce: z
    .string()
    .regex(BASE64_RE)
    .refine((n) => decodedLength(n) >= NONCE_MIN_BYTES, {
      message: "nonce must be at least 16 bytes",
    }),
  payload: z.unknown(),
  signature: z.string().regex(BASE64_RE),
});

export type SignedRequest = z.infer<typeof SignedRequestSchema>;
export type SignedRequestFields = Omit<SignedRequest, "signature">;
