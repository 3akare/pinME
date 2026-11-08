import { describe, expect, it } from "vitest";
import { BURNED_KEY, holdContactBurned, isBurned, wipeMailbox, type BurnStorage } from "./burn";
import { flushNotices, parseNotice, type HeldNotice, type NoticeStorage } from "./notices";

function fake() {
  const m = new Map<string, unknown>();
  let alarm: number | null = 5;
  const s: BurnStorage & NoticeStorage = {
    async get<T>(k: string) {
      return m.get(k) as T | undefined;
    },
    async put<T>(k: string, v: T) {
      m.set(k, v);
    },
    async delete(k: string) {
      return m.delete(k);
    },
    async list<T>(o: { prefix: string }) {
      return new Map([...m].filter(([k]) => k.startsWith(o.prefix))) as Map<string, T>;
    },
    async deleteAll() {
      m.clear();
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
  return { s, m, alarm: () => alarm };
}

describe("wipeMailbox", () => {
  it("removes all keys and alarms but keeps the tombstone (13.5)", async () => {
    const f = fake();
    for (const k of ["env:1:a", "rcpt:1", "notice:1", "presence:X", "rl:msg", "meta:pin"]) await f.s.put(k, 1);
    await wipeMailbox(f.s);
    expect([...f.m.keys()]).toEqual([BURNED_KEY]);
    expect(f.alarm()).toBeNull();
    expect(await isBurned(f.s)).toBe(true);
  });
});

describe("contactBurned notices", () => {
  it("is held and flushed in order, without widening parseNotice (13.11)", async () => {
    const f = fake();
    expect(await holdContactBurned(f.s, "0A1B2C3D", 1, "x")).toBe(true);
    expect(await holdContactBurned(f.s, "bad", 2, "y")).toBe(false);
    expect(parseNotice({ type: "contactBurned", pin: "0A1B2C3D" })).toBeNull();
    const sent: HeldNotice[] = [];
    await flushNotices(f.s, (n) => sent.push(n));
    expect(sent).toEqual([{ type: "contactBurned", pin: "0A1B2C3D" }]);
    expect((await f.s.list({ prefix: "notice:" })).size).toBe(0);
  });
});
