---
inclusion: fileMatch
fileMatchPattern: "src/{shared,durable,server}/**"
---

# Protocol rules

- The protocol has exactly eleven types: `challenge`, `challengeResponse`, `message`, `delivered`, `read`, `typing`, `ping`, `broadcast`, `inviteNotice`, `contactBurned`, `error`. Do not add a twelfth. Invite, accepted and presence pushes use `inviteNotice` with a `kind` field.
- Every schema is defined once in `src/shared` (Zod) and imported by client and server. Never redefine a schema or protocol type elsewhere.
- Validate against the schema for the declared type before any state change, forwarding or display. Server functions validate input the same way.
- On failure, discard the frame, leave state unchanged, and report only message type and failed field name. Invalid JSON or unknown type is discarded with no content in the error. Use `parseFrame` and `safeLog`.
- Serialize then parse must round-trip to a deeply equal value.

## Limits (from `src/shared/limits.ts`)

- Plaintext: 4096 characters. Ciphertext: 8192 bytes accepted, 8193 rejected. Nonce: exactly 24 bytes. Challenge: 32 bytes.
- Broadcast: at most 100 envelopes.
- Messages: 30 per 10 s per sender PIN. Ping: 1 per 10 s per contact. Invites: 10 per 60 min per sender PIN.
- Signed_Request: timestamp skew 60 s, nonce window 120 s, nonce at least 16 bytes.
- Display name 32, PIN_Label 24, Personal_Message 80, 20 PINs per identity.

## Error codes

| Code | Raised when |
|---|---|
| `validation_failed` | schema failure |
| `pin_unavailable` | connect to burned or unknown PIN |
| `not_a_contact` | relay gate fails |
| `rate_limited` | limiter denies (include `retryAfterSec`) |
| `verification_unavailable` | Directory unreachable and pair not cached |
| `pin_burned` | invite or message to burned PIN |
| `not_found`, `self_invite`, `duplicate` | invite checks |
| `invalid_signature`, `expired_timestamp`, `replay`, `unknown_pin` | Signed_Request failures |
| `private_key_not_accepted` | request body contains a key-like field |
| `collision` | registration PIN exists |
| `db_not_configured` | `DATABASE_URL` missing or empty |
| `envelope_limit_exceeded` | broadcast over 100 |
| `not_delivered` | ephemeral item (ping) with no authenticated recipient socket |

Errors carry only `code`, optional `ref`, `field`, `retryAfterSec`. Never content, ciphertext or keys.
