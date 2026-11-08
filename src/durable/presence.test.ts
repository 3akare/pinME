import { describe, expect, it } from "vitest";
import type { NoticeStorage } from "./notices";
import { flushPresence, parsePresence, presenceKey, retainPresence, type PresenceNotice } from "./presence";

function fakeStorage(): NoticeStorage & { keys(): string[] } {
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
    keys: () => [...m.keys()],
  };
}

const p = (from: string, status: "available" | "busy", personalMessage = ""): PresenceNotice => ({
  type: "inviteNotice",
  kind: "presence",
  from,
  status,
  personalMessage,
});

describe("parsePresence", () => {
  it("accepts a complete presence notice", () => {
    expect(parsePresence(p("ABCD1234", "busy", "hi"))).toEqual(p("ABCD1234", "busy", "hi"));
  });
  it("rejects invite kind, missing fields, bad pin and long messages", () => {
    expect(parsePresence({ type: "inviteNotice", kind: "invite", from: "ABCD1234" })).toBeNull();
    expect(parsePresence({ type: "inviteNotice", kind: "presence", from: "ABCD1234", status: "busy" })).toBeNull();
    expect(parsePresence(p("nope", "busy"))).toBeNull();
    expect(parsePresence(p("ABCD1234", "busy", "x".repeat(81)))).toBeNull();
  });
});

describe("presence retention", () => {
  it("keeps only the latest presence per sender", async () => {
    const s = fakeStorage();
    await retainPresence(s, p("AAAAAAAA", "available", "one"));
    await retainPresence(s, p("AAAAAAAA", "busy", "two"));
    await retainPresence(s, p("BBBBBBBB", "busy"));
    expect(s.keys().sort()).toEqual([presenceKey("AAAAAAAA"), presenceKey("BBBBBBBB")]);
    const got: PresenceNotice[] = [];
    expect(await flushPresence(s, (n) => got.push(n))).toBe(2);
    expect(got.find((n) => n.from === "AAAAAAAA")?.personalMessage).toBe("two");
  });

  it("deletes after delivery, and keeps items when sending fails", async () => {
    const s = fakeStorage();
    await retainPresence(s, p("AAAAAAAA", "busy"));
    await flushPresence(s, () => {
      throw new Error("closed");
    });
    expect(s.keys()).toHaveLength(1);
    expect(await flushPresence(s, () => {})).toBe(1);
    expect(s.keys()).toHaveLength(0);
  });
});
