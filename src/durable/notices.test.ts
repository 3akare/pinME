import { describe, expect, it } from "vitest";
import { checkInviteQuota, flushNotices, holdNotice, parseNotice, type Notice, type NoticeStorage } from "./notices";

function fakeStorage(): NoticeStorage {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return m.get(k) as T | undefined;
    },
    async put<T>(k: string, v: T) {
      m.set(k, JSON.parse(JSON.stringify(v)));
    },
    async delete(k: string) {
      return m.delete(k);
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...m].filter(([k]) => k.startsWith(prefix))) as Map<string, T>;
    },
  };
}

const notice = (kind: "invite" | "accepted", from = "ABCD1234"): Notice => ({ type: "inviteNotice", kind, from });

describe("invite quota", () => {
  it("allows 10 per hour, persisted across calls, and frees after the window", async () => {
    const s = fakeStorage();
    for (let i = 0; i < 10; i++) expect((await checkInviteQuota(s, 1000 + i)).ok).toBe(true);
    expect((await checkInviteQuota(s, 2000)).ok).toBe(false);
    expect((await checkInviteQuota(s, 1000 + 3_600_000 + 10)).ok).toBe(true);
  });
});

describe("held notices", () => {
  it("flushes in arrival order and deletes them", async () => {
    const s = fakeStorage();
    await holdNotice(s, notice("accepted"), 20, "b");
    await holdNotice(s, notice("invite"), 10, "a");
    const got: string[] = [];
    expect(await flushNotices(s, (n) => got.push(n.type === "inviteNotice" ? n.kind : n.type))).toBe(2);
    expect(got).toEqual(["invite", "accepted"]);
    expect(await flushNotices(s, () => got.push("x"))).toBe(0);
  });

  it("keeps notices when sending fails", async () => {
    const s = fakeStorage();
    await holdNotice(s, notice("invite"), 10, "a");
    await flushNotices(s, () => {
      throw new Error("closed");
    });
    expect(await flushNotices(s, () => {})).toBe(1);
  });

  it("rejects presence and malformed notices", () => {
    expect(parseNotice({ type: "inviteNotice", kind: "presence", from: "ABCD1234" })).toBeNull();
    expect(parseNotice({ type: "ping" })).toBeNull();
  });
});
