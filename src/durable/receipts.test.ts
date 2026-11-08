import { describe, expect, it } from "vitest";
import { ENVELOPE_TTL_MS, type OutboxStorage } from "./outbox";
import { flushReceipts, purgeReceipts, storeReceipt } from "./receipts";

function memStorage(): OutboxStorage & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(k: string) {
      return map.get(k) as T | undefined;
    },
    async put(k, v) {
      map.set(k, v);
    },
    async delete(k) {
      return map.delete(k);
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...map].filter(([k]) => k.startsWith(prefix))) as Map<string, T>;
    },
  };
}
const ID = "11111111-1111-4111-8111-111111111111";

describe("stored receipts", () => {
  it("flushes in order then deletes", async () => {
    const s = memStorage();
    await storeReceipt(s, { kind: "read", from: "AAAAAAAA", messageId: ID, storedAt: 2 }, "b");
    await storeReceipt(s, { kind: "delivered", from: "AAAAAAAA", messageId: ID, storedAt: 1 }, "a");
    const seen: string[] = [];
    expect(await flushReceipts(s, (f) => seen.push(f.type))).toBe(2);
    expect(seen).toEqual(["delivered", "read"]);
    expect(s.map.size).toBe(0);
  });

  it("purges receipts older than 30 days", async () => {
    const s = memStorage();
    await storeReceipt(s, { kind: "read", from: "AAAAAAAA", messageId: ID, storedAt: 0 }, "a");
    expect(await purgeReceipts(s, ENVELOPE_TTL_MS)).toBe(ENVELOPE_TTL_MS + 1);
    expect(await purgeReceipts(s, ENVELOPE_TTL_MS + 1)).toBeNull();
    expect(s.map.size).toBe(0);
  });
});
