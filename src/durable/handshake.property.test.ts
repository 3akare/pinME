import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { handleUnauthenticated, type SocketAttachment } from "./handshake";
import type { DirectoryClient } from "./directoryClient";

// Feature: pinme-burnable-pin-messenger, Property 14: Unauthenticated sockets are inert
// **Validates: Requirements 6.8**

/** Directory that records any call; an inert socket must never touch it. */
function spyDirectory() {
  const calls: string[] = [];
  const directory = {
    async lookupPin(pin: string) {
      calls.push(pin);
      throw new Error("directory must not be consulted");
    },
    async isContactPair(a: string, b: string) {
      calls.push(`${a}:${b}`);
      throw new Error("directory must not be consulted");
    },
    async mayRelay(a: string, b: string) {
      calls.push(`${a}:${b}`);
      throw new Error("directory must not be consulted");
    },
  } as unknown as DirectoryClient;
  return { directory, calls };
}

const attachmentArb: fc.Arbitrary<SocketAttachment> = fc.record({
  pin: fc.stringMatching(/^[0-9]{6}$/),
  authenticated: fc.constant(false),
  challenge: fc.base64String({ minLength: 4, maxLength: 44 }),
  challengeExpiresAt: fc.integer({ min: 0, max: 2_000_000 }),
});

// Strings that are not valid challengeResponse frames.
const nonResponseString = fc.oneof(
  fc.string(),
  fc.json(),
  fc.constantFrom("", "null", "[]", "{}", "{", '{"type":"challengeResponse"}', '{"type":"challengeResponse","signature":5}'),
  fc.record({ type: fc.string().filter((t) => t !== "challengeResponse") }, { requiredKeys: ["type"] }).map((o) => JSON.stringify(o)),
  fc.constantFrom("message", "ping", "burn", "ack", "challenge", "ready").chain((type) =>
    fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue()).map((d) => JSON.stringify({ ...d, type })),
  ),
);

const binaryRaw = fc.uint8Array({ maxLength: 64 }).map((u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer);

describe("Property 14: unauthenticated sockets are inert", () => {
  it("ignores any non-challengeResponse message without state change or directory access", async () => {
    await fc.assert(
      fc.asyncProperty(
        attachmentArb,
        fc.oneof(nonResponseString, binaryRaw),
        fc.integer({ min: 0, max: 3_000_000 }),
        async (attachment, raw, now) => {
          const before = structuredClone(attachment);
          const { directory, calls } = spyDirectory();
          const outcome = await handleUnauthenticated(attachment, raw, directory, now);
          expect(outcome).toEqual({ kind: "ignored" });
          expect(attachment).toEqual(before);
          expect(calls).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
