import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";
import { MESSAGE_TYPES, parseFrame } from "./protocol";

const id = "123e4567-e89b-42d3-a456-426614174000";
const env = (ct: number) => ({
  to: "ABCDEF01",
  messageId: id,
  nonce: bytesToBase64(new Uint8Array(24)),
  ciphertext: bytesToBase64(new Uint8Array(ct)),
});

describe("Property 33: Protocol validation discards bad input", () => {
  /** **Validates: Requirements 15.2, 15.3, 15.5, 15.6, 15.8** */
  it("any string frame is parsed as one of the eleven types or discarded without leaking content", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json(), fc.string({ unit: "binary" })), fc.constantFrom("server", "client"), (raw, dir) => {
        const r = parseFrame(raw, dir);
        if (r.ok) {
          expect(MESSAGE_TYPES).toContain(r.value.type);
        } else {
          const keys = Object.keys(r);
          if (r.reason === "validation_failed") {
            expect(keys.sort()).toEqual(["field", "ok", "reason", "type"]);
            expect(r.field).toMatch(/^[A-Za-z0-9_.]{1,64}$/);
            expect(MESSAGE_TYPES).toContain(r.type);
          } else {
            expect(keys.sort()).toEqual(["ok", "reason"]);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  /** **Validates: Requirements 15.3, 15.5** */
  it("arbitrary JSON values never throw and non-objects are discarded", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.constantFrom("server", "client"), (v, dir) => {
        const r = parseFrame(JSON.stringify(v), dir);
        if (v === null || typeof v !== "object" || Array.isArray(v)) expect(r.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  /** **Validates: Requirements 15.4, 15.6** */
  it("error reports never contain a secret value placed in a bad field", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 12 }).filter((s) => /^[A-Za-z0-9 ]+$/.test(s) && !MESSAGE_TYPES.includes(s as never)), (secret) => {
        const r = parseFrame(JSON.stringify({ type: "typing", to: secret, extra: secret }), "client");
        expect(r.ok).toBe(false);
        expect(JSON.stringify(r)).not.toContain(secret);
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 15.8** */
  it("ciphertext up to 8192 bytes accepted; over 8192 rejected", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8192 }), fc.integer({ min: 8193, max: 12000 }), (ok, bad) => {
        expect(parseFrame(JSON.stringify({ type: "message", envelope: env(ok) }), "client").ok).toBe(true);
        expect(parseFrame(JSON.stringify({ type: "message", envelope: env(bad) }), "client").ok).toBe(false);
      }),
      { numRuns: 50 },
    );
    expect(parseFrame(JSON.stringify({ type: "message", envelope: env(8192) }), "client").ok).toBe(true);
    expect(parseFrame(JSON.stringify({ type: "message", envelope: env(8193) }), "client").ok).toBe(false);
  });

  /** **Validates: Requirements 15.2, 15.5** */
  it("unknown type strings are discarded", () => {
    fc.assert(
      fc.property(fc.string().filter((s) => !MESSAGE_TYPES.includes(s as never)), (type) => {
        const r = parseFrame(JSON.stringify({ type }), "client");
        expect(r).toEqual({ ok: false, reason: "unknown_type" });
      }),
      { numRuns: 100 },
    );
  });
});
