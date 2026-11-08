import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";
import { CHALLENGE_BYTES, MAX_CIPHERTEXT_BYTES, NONCE_BYTES, PERSONAL_MESSAGE_MAX } from "./limits";
import { ClientMsg, ERROR_CODES, ServerMsg } from "./protocol";

const pin = fc.stringMatching(/^[0-9A-F]{8}$/);
const uuid = fc.uuid({ version: 4 });
const bytesB64 = (min: number, max = min) =>
  fc.uint8Array({ minLength: min, maxLength: max }).map(bytesToBase64);

const envelope = fc.record({
  to: pin,
  messageId: uuid,
  nonce: bytesB64(NONCE_BYTES),
  ciphertext: bytesB64(1, 256),
});

const serverMsg = fc.oneof(
  fc.record({ type: fc.constant("challenge" as const), challenge: bytesB64(CHALLENGE_BYTES) }),
  fc.record({ type: fc.constant("message" as const), from: pin, envelope }),
  fc.record({ type: fc.constant("delivered" as const), from: pin, messageId: uuid }),
  fc.record({ type: fc.constant("read" as const), from: pin, messageId: uuid }),
  fc.record({ type: fc.constant("typing" as const), from: pin }),
  fc.record({ type: fc.constant("ping" as const), from: pin }),
  fc.record(
    {
      type: fc.constant("inviteNotice" as const),
      kind: fc.constantFrom("invite" as const, "accepted" as const, "presence" as const),
      from: pin,
      inviteId: uuid,
      status: fc.constantFrom("available" as const, "busy" as const),
      personalMessage: fc.string({ maxLength: PERSONAL_MESSAGE_MAX }),
    },
    { requiredKeys: ["type", "kind", "from"] },
  ),
  fc.record({ type: fc.constant("contactBurned" as const), pin }),
  fc.record(
    {
      type: fc.constant("error" as const),
      code: fc.constantFrom(...ERROR_CODES),
      ref: fc.string({ maxLength: 64 }),
      field: fc.string({ maxLength: 64 }),
      retryAfterSec: fc.nat(),
    },
    { requiredKeys: ["type", "code"] },
  ),
);

const clientMsg = fc.oneof(
  fc.record({ type: fc.constant("challengeResponse" as const), signature: bytesB64(64) }),
  fc.record({ type: fc.constant("message" as const), envelope }),
  fc.record({
    type: fc.constant("broadcast" as const),
    envelopes: fc.array(envelope, { minLength: 1, maxLength: 5 }),
  }),
  fc.record({ type: fc.constant("delivered" as const), to: pin, messageId: uuid }),
  fc.record({ type: fc.constant("read" as const), to: pin, messageId: uuid }),
  fc.record({ type: fc.constant("typing" as const), to: pin }),
  fc.record({ type: fc.constant("ping" as const), to: pin }),
);

describe("Property 34: Protocol round trip", () => {
  /** **Validates: Requirements 15.9** */
  it("ServerMsg.parse(JSON round trip of m) deep-equals m", () => {
    fc.assert(
      fc.property(serverMsg, (m) => {
        expect(ServerMsg.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
      }),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 15.9** */
  it("ClientMsg.parse(JSON round trip of m) deep-equals m", () => {
    fc.assert(
      fc.property(clientMsg, (m) => {
        expect(ClientMsg.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
      }),
      { numRuns: 200 },
    );
  });

  it("accepts a ciphertext of exactly the maximum size", () => {
    const m = {
      type: "message" as const,
      envelope: {
        to: "ABCDEF01",
        messageId: "123e4567-e89b-42d3-a456-426614174000",
        nonce: bytesToBase64(new Uint8Array(NONCE_BYTES)),
        ciphertext: bytesToBase64(new Uint8Array(MAX_CIPHERTEXT_BYTES)),
      },
    };
    expect(ClientMsg.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
});
