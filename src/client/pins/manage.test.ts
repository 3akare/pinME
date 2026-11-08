import { describe, expect, it, vi } from "vitest";
import { createConnectionManager } from "../net/manager";
import type { Session } from "../net/session";
import type { PinRecord } from "../storage";
import {
  createAdditionalPin,
  MAX_PINS_MESSAGE,
  PIN_LABEL_MESSAGE,
  renamePin,
  type ManagePinsDeps,
} from "./manage";

const u8 = (n = 32) => new Uint8Array(n).fill(1);
const rec = (pin: string, label = "L"): PinRecord => ({
  pin,
  label,
  boxSk: u8(),
  boxPk: u8(),
  signSk: u8(),
  signPk: u8(),
  status: "active",
  personalMessage: "",
  createdAt: 0,
});

function setup(initial: PinRecord[], registerOk = true) {
  const pins = [...initial];
  const close = vi.fn();
  const start = vi.fn((): Session => ({ dispatcher: {} as never, send: () => true, close }));
  const connections = createConnectionManager({ urlFor: (p) => `ws://x/ws/${p}`, start });
  const registerPin = vi.fn(async () => (registerOk ? { ok: true as const } : { ok: false as const, code: "x" }));
  const savePin = vi.fn(async (r: PinRecord) => {
    const i = pins.findIndex((p) => p.pin === r.pin);
    if (i >= 0) pins[i] = r;
    else pins.push(r);
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
  return { deps, pins, start, close, registerPin, savePin, connections };
}

describe("multi-PIN management", () => {
  it("creates a PIN, stores it and starts exactly one session", async () => {
    const s = setup([]);
    const r = await createAdditionalPin(s.deps, { displayName: "Me", label: " Work " });
    expect(r.label).toBe("Work");
    expect(s.pins).toHaveLength(1);
    expect(s.start).toHaveBeenCalledTimes(1);
    s.connections.add(r);
    expect(s.start).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid labels without registering", async () => {
    const s = setup([]);
    for (const label of ["", "   ", "x".repeat(25)]) {
      await expect(createAdditionalPin(s.deps, { displayName: "Me", label })).rejects.toThrow(PIN_LABEL_MESSAGE);
    }
    expect(s.registerPin).not.toHaveBeenCalled();
  });

  it("rejects creation at 20 PINs", async () => {
    const s = setup(Array.from({ length: 20 }, (_, i) => rec(i.toString(16).toUpperCase().padStart(8, "0"))));
    await expect(createAdditionalPin(s.deps, { displayName: "Me", label: "a" })).rejects.toThrow(MAX_PINS_MESSAGE);
    expect(s.registerPin).not.toHaveBeenCalled();
    expect(s.pins).toHaveLength(20);
  });

  it("does not store or connect when registration fails", async () => {
    const s = setup([], false);
    await expect(createAdditionalPin(s.deps, { displayName: "Me", label: "a" })).rejects.toThrow();
    expect(s.pins).toHaveLength(0);
    expect(s.start).not.toHaveBeenCalled();
  });

  it("renames locally and rejects invalid labels", async () => {
    const s = setup([rec("AAAAAAAA", "old")]);
    await renamePin(s.deps, "AAAAAAAA", "new");
    expect(s.pins[0].label).toBe("new");
    expect(s.registerPin).not.toHaveBeenCalled();
    await expect(renamePin(s.deps, "AAAAAAAA", "  ")).rejects.toThrow(PIN_LABEL_MESSAGE);
    expect(s.pins[0].label).toBe("new");
  });

  it("sync keeps one session per active PIN and closes removed ones", () => {
    const s = setup([]);
    const a = rec("AAAAAAAA");
    const b = rec("BBBBBBBB");
    s.connections.sync([a, b]);
    s.connections.sync([a, b]);
    expect(s.start).toHaveBeenCalledTimes(2);
    s.connections.sync([a]);
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.connections.pins()).toEqual(["AAAAAAAA"]);
  });
});
