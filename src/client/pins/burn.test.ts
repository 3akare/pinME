import { describe, expect, it, vi } from "vitest";
import { BURN_FAILED_MESSAGE, burnPinFlow, type BurnFlowDeps } from "./burn";
const own = { pin: "AAAA1111", signSk: new Uint8Array(64) };
function setup(over: Partial<BurnFlowDeps> = {}) {
  const calls: string[] = [];
  const deps: BurnFlowDeps = {
    signRequest: () => new Uint8Array(64),
    randomBytes: (n) => new Uint8Array(n),
    burnPinFn: vi.fn(async () => ({ ok: true })),
    playAnimation: async () => void calls.push("animation"),
    cleanup: async () => void calls.push("cleanup"),
    closeSession: () => void calls.push("close"),
    updateStores: () => void calls.push("stores"),
    ...over,
  };
  return { deps, calls };
}
describe("burnPinFlow", () => {
  it("signs a burn request with empty payload, animates, then cleans up", async () => {
    const { deps, calls } = setup();
    expect(await burnPinFlow(deps, own)).toEqual({ ok: true });
    const req = (deps.burnPinFn as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req).toMatchObject({ pin: own.pin, action: "burn", payload: {} });
    expect(calls).toEqual(["animation", "cleanup", "close", "stores"]);
  });
  it("keeps everything and skips animation on server error", async () => {
    const { deps, calls } = setup({ burnPinFn: async () => ({ ok: false }) });
    expect(await burnPinFlow(deps, own)).toEqual({ ok: false, message: BURN_FAILED_MESSAGE });
    expect(calls).toEqual([]);
  });
  it("keeps everything and skips animation on thrown error", async () => {
    const { deps, calls } = setup({ burnPinFn: async () => { throw new Error("net"); } });
    expect((await burnPinFlow(deps, own)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it("times out when there is no response", async () => {
    const { deps, calls } = setup({ burnPinFn: () => new Promise(() => {}), timeoutMs: 20 });
    expect(await burnPinFlow(deps, own)).toEqual({ ok: false, message: BURN_FAILED_MESSAGE });
    expect(calls).toEqual([]);
  });
  it("does not clean up before the animation completes", async () => {
    let finish!: () => void;
    const { deps, calls } = setup({ playAnimation: () => new Promise<void>((r) => (finish = r)) });
    const p = burnPinFlow(deps, own);
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual([]);
    finish();
    await p;
    expect(calls[0]).toBe("cleanup");
  });
  it("does not close session or update stores when cleanup fails", async () => {
    const { deps, calls } = setup({ cleanup: async () => { throw new Error("tx"); } });
    expect((await burnPinFlow(deps, own)).ok).toBe(false);
    expect(calls).toEqual(["animation"]);
  });
});
