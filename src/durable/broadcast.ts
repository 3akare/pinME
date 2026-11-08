/** Pure broadcast processing for PinMailbox (Req 12.3, 12.6, 12.7, 12.8, 12.10). */
import { MAX_BROADCAST_ENVELOPES } from "../shared/limits";
import type { Envelope, ErrorCode } from "../shared/protocol";

export interface BroadcastError {
  code: ErrorCode;
  /** Message_ID of the rejected envelope (absent for whole-message rejection). */
  ref?: string;
  /** Rejected recipient PIN. */
  to?: string;
  retryAfterMs?: number;
}

export type BroadcastStep = { ok: true } | { ok: false; error: ErrorCode };

export interface BroadcastCallbacks {
  /** Pair check for the envelope's recipient (burned check may be included). */
  checkContact(envelope: Envelope): Promise<BroadcastStep>;
  /** Consumes exactly one slot of the shared message limiter. */
  consumeRate(envelope: Envelope): Promise<{ ok: true } | { ok: false; retryAfterMs: number }>;
  /** Forwards an accepted envelope to the recipient mailbox. */
  forward(envelope: Envelope): Promise<BroadcastStep>;
}

export interface BroadcastResult {
  /** Message_IDs forwarded successfully. */
  accepted: string[];
  errors: BroadcastError[];
}

export async function processBroadcast(envelopes: readonly Envelope[], cb: BroadcastCallbacks): Promise<BroadcastResult> {
  if (envelopes.length > MAX_BROADCAST_ENVELOPES) {
    return { accepted: [], errors: [{ code: "envelope_limit_exceeded" }] };
  }
  const accepted: string[] = [];
  const errors: BroadcastError[] = [];
  for (let i = 0; i < envelopes.length; i++) {
    const env = envelopes[i]!;
    const contact = await cb.checkContact(env);
    if (!contact.ok) {
      errors.push({ code: contact.error, ref: env.messageId, to: env.to });
      continue;
    }
    const rate = await cb.consumeRate(env);
    if (!rate.ok) {
      // Stop here: this envelope and every remaining one is rejected.
      for (const rest of envelopes.slice(i)) {
        errors.push({ code: "rate_limited", ref: rest.messageId, to: rest.to, retryAfterMs: rate.retryAfterMs });
      }
      break;
    }
    const fwd = await cb.forward(env);
    if (fwd.ok) accepted.push(env.messageId);
    else errors.push({ code: fwd.error, ref: env.messageId, to: env.to });
  }
  return { accepted, errors };
}
