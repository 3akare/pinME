import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { createConnectionManager } from "../net/manager";
import type { Session } from "../net/session";
import type { PinRecord } from "../storage";
import { createAdditionalPin, MAX_PINS_MESSAGE, type ManagePinsDeps } from "./manage";

const u8 = () => new Uint8Array(32).fill(1);
const rec = (i: number): PinRecord => ({
  pin: i.toString(16).toUpperCase().padStart(8, "0"),
  label: `L${i}`,
  boxSk: u8(),
  boxPk: u8(),
  signSk: u8(),
  signPk: u8(),
  status: "active",
  personalMessage: "",
  createdAt: 0,
});

function setup(count: number) {
  const pins = Array.from({ length: count }, (_, i) => rec(i));
  const registerPin = vi.fn(async () => ({ ok: true as const }));
  const savePin = vi.fn(async (r: PinRecord) => {
    pins.push(r);
  });
  const connections = createConnectionManager({
    urlFor: (p) => `ws://x/ws/${p}`,
    start: (): Session => ({ dispatcher: {} as never, send: () => true, onAuthenticated: () => () => {}, reconnect: () => {}, close: () => {} }),
  });
  const deps: ManagePinsDeps = {
    getPins: () => pins,
    createPinDeps: {
      randomBytes: (n) => new Uint8Array(n).fill(7),
      generatePinKeys: () => ({
        box: { publicKey: u8(), privateKey: u8() },
        sign: { publicKey: u8(), privateKey: u8() },
      }),
      registerPin,
      savePin,
    },
    savePin,
    connections,
  };
  return { deps, pins };
}

// Feature: pinme-burnable-pin-messenger, Property 6: PIN count limit
describe("Property 6: PIN count limit", () => {
  it("**Validates: Requirements 3.1, 3.4** creation succeeds iff c < 20; rejection leaves PINs unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20 }), async (c) => {
        const { deps, pins } = setup(c);
        const before = [...pins];
        const result = await createAdditionalPin(deps, { displayName: "Me", label: "ok" }).then(
          (r) => ({ ok: true as const, r }),
          (e: Error) => ({ ok: false as const, e }),
        );
        if (c < 20) {
          expect(result.ok).toBe(true);
          expect(pins).toHaveLength(c + 1);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.e.message).toBe(MAX_PINS_MESSAGE);
          expect(pins).toEqual(before);
        }
      }),
      { numRuns: 100 },
    );
  });
});
