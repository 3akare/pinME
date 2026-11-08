import { describe, expect, it } from "vitest";
import { createPin, PinCreationError, type CreatePinDeps, type RegisterResult } from "./createPin";
import type { PinRecord } from "../storage";

function setup(results: RegisterResult[]) {
  const saved: PinRecord[] = [];
  const pins: string[] = [];
  let ctr = 0;
  const deps: CreatePinDeps = {
    randomBytes: (n) => new Uint8Array(n).fill(++ctr),
    generatePinKeys: () => ({
      box: { publicKey: new Uint8Array(32).fill(ctr), privateKey: new Uint8Array(32).fill(ctr) },
      sign: { publicKey: new Uint8Array(32).fill(ctr), privateKey: new Uint8Array(64).fill(ctr) },
    }),
    registerPin: async (b) => {
      pins.push(b.pin);
      return results[pins.length - 1] ?? { ok: true };
    },
    savePin: async (r) => void saved.push(r),
    now: () => 42,
  };
  return { deps, saved, pins };
}
const collision: RegisterResult = { ok: false, code: "collision" };
const input = { displayName: "Ann", label: "Main" };

describe("createPin", () => {
  it("persists after first success", async () => {
    const { deps, saved } = setup([{ ok: true }]);
    const rec = await createPin(deps, input);
    expect(saved).toEqual([rec]);
    expect(rec.createdAt).toBe(42);
  });
  it("retries on collision with a fresh PIN and saves once", async () => {
    const { deps, saved, pins } = setup([collision, collision, { ok: true }]);
    const rec = await createPin(deps, input);
    expect(new Set(pins).size).toBe(3);
    expect(saved).toHaveLength(1);
    expect(rec.pin).toBe(pins[2]);
  });
  it("succeeds on the 6th attempt (5 retries)", async () => {
    const { deps, saved } = setup([collision, collision, collision, collision, collision, { ok: true }]);
    await createPin(deps, input);
    expect(saved).toHaveLength(1);
  });
  it("fails after 6 collisions and stores nothing", async () => {
    const { deps, saved, pins } = setup(Array(6).fill(collision));
    await expect(createPin(deps, input)).rejects.toThrow("PIN creation failed");
    expect(pins).toHaveLength(6);
    expect(saved).toHaveLength(0);
  });
  it("does not retry non-collision errors and stores nothing", async () => {
    const { deps, saved, pins } = setup([{ ok: false, code: "verification_unavailable" }]);
    await expect(createPin(deps, input)).rejects.toBeInstanceOf(PinCreationError);
    expect(pins).toHaveLength(1);
    expect(saved).toHaveLength(0);
  });
});
