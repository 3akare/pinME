import { describe, expect, it, vi } from "vitest";
import type { SignedRequest } from "../../shared/signed";
import type { PinRecord } from "../storage";
import { createProfileUpdater, type ProfileUpdaterDeps } from "./update";

const PIN = "ABCD1234";
function pinRec(): PinRecord {
  return {
    pin: PIN,
    label: "Main",
    boxSk: new Uint8Array(32),
    boxPk: new Uint8Array(32),
    signSk: new Uint8Array(64),
    signPk: new Uint8Array(32),
    status: "active",
    presence: "available",
    personalMessage: "old",
    createdAt: 0,
  };
}
function setup(fn: ProfileUpdaterDeps["updateProfileFn"], timeoutMs = 50) {
  let rec = pinRec();
  const put = vi.fn(async (r: PinRecord) => {
    rec = r;
  });
  const signRequest = vi.fn(() => new Uint8Array(64).fill(7));
  const onSaved = vi.fn();
  const update = createProfileUpdater({
    repos: { pinRepo: { get: async () => rec, getAll: async () => [rec], put, delete: async () => {} } },
    signRequest,
    randomBytes: (n) => new Uint8Array(n).fill(1),
    updateProfileFn: fn,
    onSaved,
    now: () => 1000,
    timeoutMs,
  });
  return { update, put, signRequest, onSaved, get rec() { return rec; } };
}

describe("createProfileUpdater", () => {
  it("signs an updateProfile request and persists on success", async () => {
     
    const fn = vi.fn(async (_r: SignedRequest) => ({ ok: true as const, value: { status: "busy" as const, personalMessage: "hi" } }));
    const s = setup(fn);
    const res = await s.update(PIN, { status: "busy", personalMessage: "hi" });
    expect(res).toEqual({ ok: true, status: "busy", personalMessage: "hi" });
    const req = fn.mock.calls[0]![0];
    expect(req.action).toBe("updateProfile");
    expect(req.pin).toBe(PIN);
    expect(req.payload).toEqual({ status: "busy", personalMessage: "hi" });
    expect(req.signature.length).toBeGreaterThan(0);
    expect(s.rec.presence).toBe("busy");
    expect(s.rec.personalMessage).toBe("hi");
    expect(s.onSaved).toHaveBeenCalledOnce();
  });

  it("keeps last saved values on server failure", async () => {
    const s = setup(async () => ({ ok: false as const, code: "rate_limited" as const }));
    const res = await s.update(PIN, { personalMessage: "new" });
    expect(res).toEqual({ ok: false, code: "rate_limited" });
    expect(s.put).not.toHaveBeenCalled();
    expect(s.rec.personalMessage).toBe("old");
  });

  it("fails on timeout and keeps saved values", async () => {
    const s = setup(() => new Promise(() => {}), 20);
    const res = await s.update(PIN, { status: "busy" });
    expect(res).toEqual({ ok: false, code: "timeout" });
    expect(s.put).not.toHaveBeenCalled();
  });

  it("fails when the call throws", async () => {
    const s = setup(async () => {
      throw new Error("net");
    });
    expect(await s.update(PIN, { status: "busy" })).toEqual({ ok: false, code: "network_error" });
    expect(s.put).not.toHaveBeenCalled();
  });

  it("rejects an 81-character message without calling the server", async () => {
    const fn = vi.fn();
    const s = setup(fn);
    const res = await s.update(PIN, { personalMessage: "x".repeat(81) });
    expect(res).toEqual({ ok: false, code: "validation_failed", field: "personalMessage" });
    expect(fn).not.toHaveBeenCalled();
    expect(s.signRequest).not.toHaveBeenCalled();
  });

  it("accepts an 80-character message", async () => {
    const msg = "x".repeat(80);
    const s = setup(async () => ({ ok: true as const, value: { status: "available" as const, personalMessage: msg } }));
    expect((await s.update(PIN, { personalMessage: msg })).ok).toBe(true);
  });
});
