/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PinMailbox } from "./PinMailbox";

const key = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));

async function mailbox() {
  const real = await runInDurableObject(env.PIN_MAILBOX.get(env.PIN_MAILBOX.newUniqueId()), (_i, state) => state);
  const map = new Map<string, unknown>();
  const storage = {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
    delete: async (k: string) => map.delete(k),
    list: async ({ prefix, limit }: { prefix: string; limit?: number }) =>
      new Map([...map].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit ?? Infinity)),
  };
  const m = new PinMailbox(real, env as never, {});
  Object.defineProperty(m, "ctx", { value: { storage }, configurable: true });
  return { m, map };
}

describe("PinMailbox prekeys", () => {
  it("serves the signed prekey with each one-time prekey exactly once", async () => {
    const { m } = await mailbox();
    expect(await m.takePrekeyBundle()).toBeNull();
    const spk = { id: 1, pub: key(1), sig: btoa("x".repeat(64)) };
    expect(await m.putPrekeys({ spk, opks: [{ id: 2, pub: key(2) }, { id: 3, pub: key(3) }] })).toEqual({ opkCount: 2 });
    const first = await m.takePrekeyBundle();
    const second = await m.takePrekeyBundle();
    expect(first?.spk).toEqual(spk);
    expect(new Set([first?.opk?.id, second?.opk?.id])).toEqual(new Set([2, 3]));
    expect(await m.takePrekeyBundle()).toEqual({ spk });
  });

  it("does not store the same one-time prekey twice, and caps the pool", async () => {
    const { m } = await mailbox();
    await m.putPrekeys({ opks: [{ id: 9, pub: key(9) }] });
    expect(await m.putPrekeys({ opks: [{ id: 9, pub: key(9) }] })).toEqual({ opkCount: 1 });
    const many = Array.from({ length: 150 }, (_, i) => ({ id: 100 + i, pub: key(4) }));
    expect((await m.putPrekeys({ opks: many })).opkCount).toBe(100);
  });
});
